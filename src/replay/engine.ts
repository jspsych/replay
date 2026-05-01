import type { RecordedEvent, DomNode, StylesheetEvent } from "../schema/types.js";
import {
  instantiateDom,
  removeFromMap,
  installStylesheet,
  updateStylesheet,
  removeStylesheet,
} from "./dom.js";
import type { OverlayController } from "../ui/overlay.js";

/**
 * The engine schedules and dispatches both per-trial events
 * (`RecordedEvent`) and session-level stylesheet events
 * (`StylesheetEvent`). They share the `type` and `t` discriminators, so they
 * can be merged into a single timeline by the caller.
 */
export type SchedulableEvent = RecordedEvent | StylesheetEvent;

export interface EngineCallbacks {
  overlay: OverlayController;
  /** Called when all events have fired (reached t_end) */
  onComplete: () => void;
  /** Called each tick with current elapsed time in ms */
  onTick: (elapsed: number) => void;
}

/**
 * Manages scheduling and dispatching of recorded events for a single trial.
 */
export class ReplayEngine {
  private timeouts: ReturnType<typeof setTimeout>[] = [];
  private rafHandle: number | null = null;
  private playing = false;
  private startWallTime = 0;
  private startElapsed = 0;
  private speed = 1;

  private readonly idMap: Map<number, Node>;
  private readonly sheetMap: Map<number, HTMLElement>;
  private readonly iframeDoc: Document;
  private readonly callbacks: EngineCallbacks;

  constructor(
    iframeDoc: Document,
    idMap: Map<number, Node>,
    callbacks: EngineCallbacks,
    sheetMap: Map<number, HTMLElement> = new Map()
  ) {
    this.iframeDoc = iframeDoc;
    this.idMap = idMap;
    this.sheetMap = sheetMap;
    this.callbacks = callbacks;
  }

  /** Schedule all events from `fromElapsed` onwards, playing at `speed`. */
  scheduleEvents(
    events: SchedulableEvent[],
    duration: number,
    fromElapsed: number,
    speed: number
  ): void {
    this.cancelAll();
    this.speed = speed;
    this.startElapsed = fromElapsed;
    this.startWallTime = performance.now();
    this.playing = true;

    for (const ev of events) {
      if (ev.t < fromElapsed) continue;
      const delay = (ev.t - fromElapsed) / speed;
      const handle = setTimeout(() => {
        this.applyEvent(ev);
        this.callbacks.onTick(this.currentElapsed());
      }, delay);
      this.timeouts.push(handle);
    }

    // Schedule end
    const endDelay = (duration - fromElapsed) / speed;
    const endHandle = setTimeout(() => {
      this.playing = false;
      this.callbacks.onTick(duration);
      this.callbacks.onComplete();
    }, endDelay);
    this.timeouts.push(endHandle);

    // RAF ticker for smooth scrub bar updates
    this.scheduleTick();
  }

  private scheduleTick(): void {
    if (!this.playing) return;
    this.rafHandle = requestAnimationFrame(() => {
      if (!this.playing) return;
      this.callbacks.onTick(this.currentElapsed());
      this.scheduleTick();
    });
  }

  currentElapsed(): number {
    if (!this.playing) return this.startElapsed;
    const wall = performance.now() - this.startWallTime;
    return this.startElapsed + wall * this.speed;
  }

  pause(): void {
    if (!this.playing) return;
    this.startElapsed = this.currentElapsed();
    this.playing = false;
    this.cancelAll();
  }

  resume(events: SchedulableEvent[], duration: number, speed: number): void {
    this.scheduleEvents(events, duration, this.startElapsed, speed);
  }

  cancelAll(): void {
    for (const h of this.timeouts) clearTimeout(h);
    this.timeouts = [];
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
    this.playing = false;
  }

  isPlaying(): boolean {
    return this.playing;
  }

  /**
   * Synchronously apply all events with t <= targetMs.
   * Used for seeking: re-instantiate the DOM then call this to fast-forward
   * to the seek point without scheduling timeouts.
   * After this call the engine is paused at targetMs.
   */
  applyEventsSync(events: SchedulableEvent[], targetMs: number): void {
    this.cancelAll();
    this.startElapsed = targetMs;
    for (const ev of events) {
      if (ev.t <= targetMs) {
        this.applyEvent(ev);
      }
    }
  }

  private applyEvent(ev: SchedulableEvent): void {
    try {
      this.dispatchEvent(ev);
    } catch (err) {
      console.warn("[replay] Failed to apply event:", ev.type, err);
    }
  }

  private dispatchEvent(ev: SchedulableEvent): void {
    switch (ev.type) {
      case "dom.add": {
        const parentNode = this.idMap.get(ev.parent);
        if (!parentNode) {
          console.warn(`[replay] dom.add: parent node ${ev.parent} not found`);
          return;
        }
        // Insert before sibling, or append
        let refNode: Node | null = null;
        if (ev.before !== null) {
          refNode = this.idMap.get(ev.before) ?? null;
        }
        const newNode = this.createNode(ev.node);
        if (refNode) {
          parentNode.insertBefore(newNode, refNode);
        } else {
          parentNode.appendChild(newNode);
        }
        break;
      }

      case "dom.remove": {
        const nodeToRemove = this.idMap.get(ev.node);
        if (!nodeToRemove) return;
        removeFromMap(nodeToRemove, this.idMap);
        nodeToRemove.parentNode?.removeChild(nodeToRemove);
        break;
      }

      case "dom.attr": {
        const el = this.idMap.get(ev.node) as Element | undefined;
        if (!el || !(el instanceof Element)) return;
        if (ev.name.startsWith("on")) return; // safety
        if (ev.value === null) {
          el.removeAttribute(ev.name);
        } else {
          try {
            el.setAttribute(ev.name, ev.value);
          } catch {
            // ignore invalid attribute names
          }
        }
        break;
      }

      case "dom.text": {
        const textNode = this.idMap.get(ev.node);
        if (!textNode) return;
        if (textNode.nodeType === Node.TEXT_NODE || textNode.nodeType === Node.COMMENT_NODE) {
          textNode.nodeValue = ev.text;
        }
        break;
      }

      case "mouse.move":
        this.callbacks.overlay.moveCursor(ev.x, ev.y);
        break;

      case "mouse.down":
      case "mouse.up":
      case "mouse.click":
        this.callbacks.overlay.moveCursor(ev.x, ev.y);
        if (ev.type === "mouse.click") {
          this.callbacks.overlay.showClick();
        }
        break;

      case "touch.start":
      case "touch.move":
      case "touch.end":
        if (ev.touches.length > 0) {
          this.callbacks.overlay.moveCursor(ev.touches[0].x, ev.touches[0].y);
        }
        break;

      case "key.down": {
        const mods: string[] = [];
        if (ev.mods.ctrl) mods.push("⌃");
        if (ev.mods.shift) mods.push("⇧");
        if (ev.mods.alt) mods.push("⌥");
        if (ev.mods.meta) mods.push("⌘");
        const label = [...mods, ev.key].join("");
        this.callbacks.overlay.showKey(label);
        break;
      }

      case "key.up":
        break;

      case "scroll.window":
        try {
          this.iframeDoc.defaultView?.scrollTo(ev.x, ev.y);
        } catch {
          // may fail in sandboxed context
        }
        break;

      case "scroll.element": {
        const el = this.idMap.get(ev.node) as HTMLElement | undefined;
        if (el && el instanceof HTMLElement) {
          el.scrollLeft = ev.x;
          el.scrollTop = ev.y;
        }
        break;
      }

      case "focus":
        this.callbacks.overlay.setBlurred(false);
        break;

      case "blur":
        this.callbacks.overlay.setBlurred(true);
        break;

      case "fullscreen.enter":
      case "fullscreen.exit":
        // Visual note only
        break;

      case "clipboard.copy":
      case "clipboard.cut":
      case "clipboard.paste":
        // Log to console; sidebar integration is out of scope for v0
        console.info(`[replay] clipboard event: ${ev.type}`, ev.text ?? "");
        break;

      case "media.play":
      case "media.pause":
      case "media.ended":
      case "media.seeked":
      case "media.time":
        // Log only in v0; actual media replay is out of scope
        console.info(`[replay] media event: ${ev.type}`, ev);
        break;

      case "input.value": {
        const el = this.idMap.get(ev.node);
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          el.value = ev.value;
        } else if (el instanceof HTMLSelectElement) {
          el.value = ev.value;
        }
        break;
      }

      case "input.checked": {
        const el = this.idMap.get(ev.node);
        if (el instanceof HTMLInputElement) {
          el.checked = ev.checked;
        }
        break;
      }

      case "input.select": {
        const el = this.idMap.get(ev.node);
        if (el instanceof HTMLSelectElement) {
          const wanted = new Set(ev.values);
          for (const opt of Array.from(el.options)) {
            opt.selected = wanted.has(opt.value);
          }
        }
        break;
      }

      case "canvas.snapshot": {
        const el = this.idMap.get(ev.node);
        if (!(el instanceof HTMLCanvasElement)) break;
        const ctx = el.getContext("2d");
        if (!ctx) break;
        const img = new Image();
        img.onload = () => {
          try {
            ctx.clearRect(0, 0, el.width, el.height);
            ctx.drawImage(img, 0, 0);
          } catch {
            // ignore (e.g., tainted canvas in strict modes)
          }
        };
        img.src = ev.data_url;
        break;
      }

      case "stylesheet.add":
        installStylesheet(ev.sheet, this.iframeDoc, this.sheetMap);
        break;

      case "stylesheet.update":
        updateStylesheet(ev.id, ev.css, this.sheetMap);
        break;

      case "stylesheet.remove":
        removeStylesheet(ev.id, this.sheetMap);
        break;

      default:
        console.warn("[replay] Unknown event type:", (ev as { type: string }).type);
        break;
    }
  }

  /**
   * Instantiate a DomNode and register all ids in idMap (recursive).
   */
  private createNode(node: DomNode): Node {
    const frag = this.iframeDoc.createDocumentFragment();
    instantiateDom(node, frag, this.idMap, this.iframeDoc);
    // instantiateDom appended to frag; return the first child
    return frag.firstChild!;
  }
}
