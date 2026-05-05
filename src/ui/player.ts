import type {
  TrialRecording,
  SessionRecording,
  StylesheetSnapshot,
} from "../schema/types.js";
import {
  ReplayEngine,
  type SchedulableEvent,
  type ViewportChangeEvent,
} from "../replay/engine.js";
import { ViewportManager } from "../replay/viewport.js";
import {
  mountInitialDom,
  installStylesheet,
  removeStylesheet,
} from "../replay/dom.js";
import type { OverlayController } from "./overlay.js";

export interface PlayerCallbacks {
  onTrialChange: (listIndex: number) => void;
  onTick: (elapsed: number, duration: number) => void;
}

/**
 * Player controller: manages play/pause/seek/trial navigation.
 */
export class Player {
  private readonly recording: SessionRecording;
  private readonly viewport: ViewportManager;
  private readonly overlay: OverlayController;
  private readonly callbacks: PlayerCallbacks;

  private trials: TrialRecording[];
  private currentListIndex = 0;
  private engine: ReplayEngine | null = null;
  private currentIdMap: Map<number, Node> = new Map();
  private currentSheetMap: Map<number, HTMLElement> = new Map();
  private speed = 1;
  private autoAdvance = false;

  // UI elements
  private readonly playPauseBtn: HTMLButtonElement;
  private readonly restartBtn: HTMLButtonElement;
  private readonly prevBtn: HTMLButtonElement;
  private readonly nextBtn: HTMLButtonElement;
  private readonly scrubBar: HTMLInputElement;
  private readonly timeDisplay: HTMLElement;
  private readonly speedSelect: HTMLSelectElement;
  private readonly autoplayCheckbox: HTMLInputElement;

  constructor(
    recording: SessionRecording,
    viewport: ViewportManager,
    overlay: OverlayController,
    callbacks: PlayerCallbacks,
    elements: {
      playPauseBtn: HTMLButtonElement;
      restartBtn: HTMLButtonElement;
      prevBtn: HTMLButtonElement;
      nextBtn: HTMLButtonElement;
      scrubBar: HTMLInputElement;
      timeDisplay: HTMLElement;
      speedSelect: HTMLSelectElement;
      autoplayCheckbox: HTMLInputElement;
    }
  ) {
    this.recording = recording;
    this.viewport = viewport;
    this.overlay = overlay;
    this.callbacks = callbacks;
    this.trials = recording.trials;

    this.playPauseBtn = elements.playPauseBtn;
    this.restartBtn = elements.restartBtn;
    this.prevBtn = elements.prevBtn;
    this.nextBtn = elements.nextBtn;
    this.scrubBar = elements.scrubBar;
    this.timeDisplay = elements.timeDisplay;
    this.speedSelect = elements.speedSelect;
    this.autoplayCheckbox = elements.autoplayCheckbox;
    this.autoAdvance = this.autoplayCheckbox.checked;

    this.bindEvents();
  }

  private bindEvents(): void {
    this.playPauseBtn.addEventListener("click", () => this.togglePlayPause());
    this.restartBtn.addEventListener("click", () => this.restartCurrentTrial());
    this.prevBtn.addEventListener("click", () => this.jumpTrial(-1));
    this.nextBtn.addEventListener("click", () => this.jumpTrial(1));

    this.speedSelect.addEventListener("change", () => {
      this.speed = Number(this.speedSelect.value);
      if (this.engine?.isPlaying()) {
        const elapsed = this.engine.currentElapsed();
        const trial = this.currentTrial();
        if (!trial) return;
        const duration = this.trialDuration(trial);
        this.engine.cancelAll();
        this.engine.scheduleEvents(
          this.trialTimeline(trial),
          duration,
          elapsed,
          this.speed,
          trial.t_dom_ready ?? 0
        );
      }
    });

    this.scrubBar.addEventListener("input", () => {
      const pct = Number(this.scrubBar.value) / 1000;
      const trial = this.currentTrial();
      if (!trial) return;
      const duration = this.trialDuration(trial);
      const target = pct * duration;
      this.seekTo(target);
    });

    this.autoplayCheckbox.addEventListener("change", () => {
      this.autoAdvance = this.autoplayCheckbox.checked;
    });
  }

  /** Stop all playback. */
  stop(): void {
    this.engine?.cancelAll();
  }

  /** Load a trial by list index (not trial_index). */
  selectTrial(listIndex: number): void {
    if (listIndex < 0 || listIndex >= this.trials.length) return;

    this.engine?.cancelAll();
    this.overlay.hide();

    this.currentListIndex = listIndex;

    const trial = this.trials[listIndex];

    // Apply viewport at t_dom_ready so any resize that happened while the
    // trial was being constructed is reflected in the initial state.
    // Mid-trial viewport changes are scheduled into the timeline below.
    const anchorT = trial.t_dom_ready ?? trial.t_start ?? 0;
    this.viewport.applyViewportAt(anchorT);

    // Reset and rebuild stylesheets up to t_dom_ready. Plugins commonly inject
    // their CSS in the t_start..t_dom_ready window, so anchoring at t_start
    // would miss the layout-defining sheet.
    this.resetStylesheetsAt(anchorT);

    // Reconstruct initial DOM
    this.currentIdMap = new Map();
    this.mountInitialDom(trial.initial_dom);

    // Set up engine
    this.engine = new ReplayEngine(
      this.viewport.iframeDoc,
      this.currentIdMap,
      {
        overlay: this.overlay,
        applyViewport: (vp) => this.viewport.applyViewport(vp),
        onComplete: () => this.handleTrialComplete(),
        onTick: (elapsed) => {
          const duration = this.trialDuration(trial);
          this.updateScrub(elapsed, duration);
          this.callbacks.onTick(elapsed, duration);
        },
      },
      this.currentSheetMap
    );

    const duration = this.trialDuration(trial);
    this.updateScrub(0, duration);
    this.setPlayPauseIcon(false);
    this.updateNavButtons();
    this.callbacks.onTrialChange(listIndex);
  }

  private mountInitialDom(initialDom: TrialRecording["initial_dom"]): void {
    const mountPoint = this.viewport.prepareMountPoint();
    if (initialDom !== null) {
      mountInitialDom(initialDom, mountPoint, this.currentIdMap, this.viewport.iframeDoc);
    }
  }

  private trialDuration(trial: TrialRecording): number {
    if (trial.t_dom_ready == null || trial.t_end == null) return 0;
    return trial.t_end - trial.t_dom_ready;
  }

  /**
   * Per-trial events merged with session-level stylesheet events and viewport
   * changes that fall inside this trial's playback window (t_dom_ready, t_end).
   * Stylesheet events and viewport changes at or before t_dom_ready are
   * applied as part of the trial-start snapshot (`resetStylesheetsAt`,
   * `applyViewportAt`), so they're excluded here to avoid double-apply.
   */
  private trialTimeline(trial: TrialRecording): SchedulableEvent[] {
    const tDomReady = trial.t_dom_ready ?? 0;
    const tEnd = trial.t_end ?? Infinity;
    const midTrialSheets = (this.recording.stylesheet_events ?? []).filter(
      (e) => e.t > tDomReady && e.t < tEnd
    );
    const midTrialViewports: ViewportChangeEvent[] = (
      this.recording.viewport_changes ?? []
    )
      .filter((c) => c.t > tDomReady && c.t < tEnd)
      .map((c) => ({
        type: "viewport.change",
        t: c.t,
        vp: {
          w: c.w,
          h: c.h,
          dpr: c.dpr,
          scale: c.scale,
          offset_x: c.offset_x,
          offset_y: c.offset_y,
        },
      }));
    if (midTrialSheets.length === 0 && midTrialViewports.length === 0) {
      return trial.events;
    }
    return [...trial.events, ...midTrialSheets, ...midTrialViewports];
  }

  /**
   * Bring the iframe stylesheet state in line with what the recording had at
   * `upToT` (the snapshot at t=0 plus every session-level stylesheet event
   * with `t <= upToT`). Diff-based: sheets already installed with matching
   * content are left alone, so seeking within a trial doesn't tear down and
   * re-add the cascade — which (in particular for `<link>` sheets) flashes
   * unstyled content before the new sheet applies.
   */
  private resetStylesheetsAt(upToT: number): void {
    const doc = this.viewport.iframeDoc;

    // Compute the desired sheet state at upToT.
    const desired = new Map<number, StylesheetSnapshot>();
    for (const sheet of this.recording.stylesheets ?? []) {
      desired.set(sheet.id, sheet);
    }
    for (const ev of this.recording.stylesheet_events ?? []) {
      if (ev.t > upToT) break;
      if (ev.type === "stylesheet.add") {
        desired.set(ev.sheet.id, ev.sheet);
      } else if (ev.type === "stylesheet.remove") {
        desired.delete(ev.id);
      } else if (ev.type === "stylesheet.update") {
        const cur = desired.get(ev.id);
        if (!cur) continue;
        // Update events carry replacement CSS. If the current desired sheet
        // is a link without captured CSS, promote it to inline so the new CSS
        // text is what we install.
        if (cur.kind === "inline") {
          desired.set(ev.id, { ...cur, css: ev.css });
        } else {
          desired.set(ev.id, { id: cur.id, kind: "inline", css: ev.css, media: cur.media });
        }
      }
    }

    // Remove any installed sheets no longer desired.
    for (const id of Array.from(this.currentSheetMap.keys())) {
      if (!desired.has(id)) {
        removeStylesheet(id, this.currentSheetMap);
      }
    }

    // For each desired sheet, install if missing or update inline css if
    // content changed. Link sheets without captured CSS are left in place
    // once installed (replacing them would refetch + flash).
    for (const [id, sheet] of desired) {
      const existing = this.currentSheetMap.get(id);
      if (!existing) {
        installStylesheet(sheet, doc, this.currentSheetMap);
        continue;
      }
      if (existing.tagName.toLowerCase() === "style" && sheet.css !== null) {
        if (existing.textContent !== sheet.css) {
          existing.textContent = sheet.css;
        }
      } else if (existing.tagName.toLowerCase() === "link" && sheet.kind === "inline") {
        // Desired changed kind from link to inline — replace.
        removeStylesheet(id, this.currentSheetMap);
        installStylesheet(sheet, doc, this.currentSheetMap);
      }
    }
  }

  private currentTrial(): TrialRecording | null {
    return this.trials[this.currentListIndex] ?? null;
  }

  togglePlayPause(): void {
    if (!this.engine) return;
    const trial = this.currentTrial();
    if (!trial) return;
    const duration = this.trialDuration(trial);

    if (this.engine.isPlaying()) {
      this.engine.pause();
      this.setPlayPauseIcon(false);
    } else {
      const elapsed = this.engine.currentElapsed();
      const tOffset = trial.t_dom_ready ?? 0;
      const timeline = this.trialTimeline(trial);
      // If at end, restart
      const from = elapsed >= duration ? 0 : elapsed;
      if (from === 0) {
        this.selectTrial(this.currentListIndex);
        this.engine!.scheduleEvents(timeline, duration, 0, this.speed, tOffset);
      } else {
        this.engine.scheduleEvents(timeline, duration, from, this.speed, tOffset);
      }
      this.setPlayPauseIcon(true);
    }
  }

  restartCurrentTrial(): void {
    this.playTrialFromStart(this.currentListIndex);
  }

  /** Load `listIndex` and immediately start playing from t=0. */
  private playTrialFromStart(listIndex: number): void {
    this.selectTrial(listIndex);
    const trial = this.currentTrial();
    if (!trial || !this.engine) return;
    const duration = this.trialDuration(trial);
    this.engine.scheduleEvents(
      this.trialTimeline(trial),
      duration,
      0,
      this.speed,
      trial.t_dom_ready ?? 0
    );
    this.setPlayPauseIcon(true);
  }

  /** Engine reached the end of the current trial. */
  private handleTrialComplete(): void {
    if (this.autoAdvance && this.currentListIndex < this.trials.length - 1) {
      this.playTrialFromStart(this.currentListIndex + 1);
    } else {
      this.setPlayPauseIcon(false);
    }
  }

  jumpTrial(delta: number): void {
    const next = this.currentListIndex + delta;
    if (next >= 0 && next < this.trials.length) {
      this.selectTrial(next);
    }
  }

  seekTo(targetMs: number): void {
    const trial = this.currentTrial();
    if (!trial) return;
    const duration = this.trialDuration(trial);
    const clamped = Math.max(0, Math.min(targetMs, duration));

    this.engine?.cancelAll();

    // Reset viewport and stylesheets to the snapshot at t_dom_ready;
    // mid-trial viewport/stylesheet events get replayed by applyEventsSync.
    const anchorT = trial.t_dom_ready ?? trial.t_start ?? 0;
    this.viewport.applyViewportAt(anchorT);
    this.resetStylesheetsAt(anchorT);

    // Re-instantiate initial DOM
    this.currentIdMap = new Map();
    this.mountInitialDom(trial.initial_dom);

    // Re-create engine with fresh id map
    this.engine = new ReplayEngine(
      this.viewport.iframeDoc,
      this.currentIdMap,
      {
        overlay: this.overlay,
        applyViewport: (vp) => this.viewport.applyViewport(vp),
        onComplete: () => this.handleTrialComplete(),
        onTick: (elapsed) => {
          this.updateScrub(elapsed, duration);
          this.callbacks.onTick(elapsed, duration);
        },
      },
      this.currentSheetMap
    );

    // Apply all events up to the seek target synchronously
    this.engine.applyEventsSync(this.trialTimeline(trial), clamped, trial.t_dom_ready ?? 0);

    // Engine keeps startElapsed at clamped; it's paused
    this.updateScrub(clamped, duration);
    this.callbacks.onTick(clamped, duration);
    this.setPlayPauseIcon(false);
  }

  private updateScrub(elapsed: number, duration: number): void {
    const pct = duration > 0 ? Math.min(elapsed / duration, 1) : 0;
    this.scrubBar.value = String(Math.round(pct * 1000));
    this.timeDisplay.textContent = `${(elapsed / 1000).toFixed(1)}s / ${(duration / 1000).toFixed(1)}s`;
  }

  private setPlayPauseIcon(playing: boolean): void {
    this.playPauseBtn.innerHTML = playing ? "&#x23F8;" : "&#x25B6;";
  }

  private updateNavButtons(): void {
    this.prevBtn.disabled = this.currentListIndex <= 0;
    this.nextBtn.disabled = this.currentListIndex >= this.trials.length - 1;
  }

  getCurrentListIndex(): number {
    return this.currentListIndex;
  }
}
