import type { SessionRecording, ViewportState } from "../schema/types.js";

/**
 * Manage the replay iframe: sizing, document preparation, viewport changes.
 *
 * Layout structure: stageContainer > stageFit > stageWrapper > iframe.
 * - The wrapper is sized to the recording's intrinsic viewport and shrunk
 *   via `transform: scale()` so the visible stage fits the available area
 *   without enlarging recordings smaller than the container.
 * - The fit element is sized to the *displayed* (post-scale) dimensions so
 *   flex centering in the container positions the stage correctly.
 */
export class ViewportManager {
  private readonly iframe: HTMLIFrameElement;
  private readonly recording: SessionRecording;
  private readonly stageContainer: HTMLElement | null;
  private readonly onScaleChange: ((scale: number) => void) | null;
  private currentVp: ViewportState;

  constructor(
    iframe: HTMLIFrameElement,
    recording: SessionRecording,
    stageContainer: HTMLElement | null = null,
    onScaleChange: ((scale: number) => void) | null = null
  ) {
    this.iframe = iframe;
    this.recording = recording;
    this.stageContainer = stageContainer;
    this.onScaleChange = onScaleChange;
    this.currentVp = recording.viewport;
    this.applyViewport(recording.viewport);
  }

  /**
   * Get the viewport state active at time `t` (ms, relative to recording_started_at_perf).
   * Falls back to the top-level viewport if no changes precede `t`.
   */
  viewportAt(t: number): ViewportState {
    let active = this.recording.viewport;
    for (const change of this.recording.viewport_changes) {
      if (change.t <= t) {
        active = change;
      } else {
        break;
      }
    }
    return active;
  }

  applyViewport(vp: ViewportState): void {
    this.currentVp = vp;
    this.iframe.width = String(vp.w);
    this.iframe.height = String(vp.h);
    const wrapper = this.iframe.parentElement;
    if (wrapper) {
      wrapper.style.width = `${vp.w}px`;
      wrapper.style.height = `${vp.h}px`;
    }
    this.refit();
  }

  /**
   * Recompute the stage scale based on available area in `stageContainer`,
   * cap at 1× (don't enlarge), and apply via transform to the wrapper plus
   * sized dimensions to the fit element. No-op if no container was provided.
   */
  refit(): void {
    if (!this.stageContainer) return;
    const wrapper = this.iframe.parentElement;
    const fit = wrapper?.parentElement;
    if (!wrapper || !fit) return;

    const styles = getComputedStyle(this.stageContainer);
    const padX = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight);
    const padY = parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom);
    const availW = this.stageContainer.clientWidth - padX;
    const availH = this.stageContainer.clientHeight - padY;
    if (availW <= 0 || availH <= 0) return;

    const scale = Math.min(availW / this.currentVp.w, availH / this.currentVp.h, 1);
    wrapper.style.transform = `scale(${scale})`;
    fit.style.width = `${this.currentVp.w * scale}px`;
    fit.style.height = `${this.currentVp.h * scale}px`;
    this.onScaleChange?.(scale);
  }

  /**
   * Apply the viewport that was active at time `t` for the given trial.
   */
  applyViewportAt(t: number): void {
    this.applyViewport(this.viewportAt(t));
  }

  /**
   * Ensure the iframe document has our shell (html/head/body with base CSS).
   * Idempotent: only writes the shell once per iframe lifetime.
   */
  ensureShell(): void {
    const doc = this.iframe.contentDocument;
    if (!doc) throw new Error("iframe document not accessible");
    if (doc.documentElement?.dataset["replayShell"] === "1") return;

    doc.open();
    // html/body need height: 100% so recorded `height: 100%` styles (e.g. on
    // jsPsych's display element) actually fill the iframe — otherwise flex
    // centering inside .jspsych-display-element collapses to zero.
    //
    // No `#jspsych-content` rule here: the recorded DOM may itself contain
    // an element with that id (jsPsych's `.jspsych-content` div sits inside
    // `.jspsych-content-wrapper`), and any sizing rule we apply collides
    // with the recorded centering layout.
    doc.write(`<!doctype html>
<html data-replay-shell="1" style="height:100%">
<head>
<meta charset="UTF-8"/>
<style>
  html, body { height: 100%; margin: 0; padding: 0; }
  body { font-family: sans-serif; }
</style>
</head>
<body></body>
</html>`);
    doc.close();
  }

  /**
   * Prepare the iframe body for mounting a recorded `initial_dom`: clear its
   * children and reset its attributes, then return the body element. The
   * caller (`mountInitialDom`) decides whether to merge the recorded body
   * into this element (when the recorded root is `<body>`) or append the
   * recorded root as a child (for the layout-spine case where the root is a
   * wrapping div). No `#jspsych-content` wrapper is synthesized here — the
   * spine carries the proper id chain itself, and old recordings rooted at
   * `#jspsych-content` mount cleanly as a direct body child.
   */
  prepareMountPoint(): HTMLElement {
    this.ensureShell();
    const body = this.iframeDoc.body;

    while (body.firstChild) body.removeChild(body.firstChild);
    for (const attr of Array.from(body.attributes)) {
      body.removeAttribute(attr.name);
    }

    return body;
  }

  get iframeDoc(): Document {
    const doc = this.iframe.contentDocument;
    if (!doc) throw new Error("iframe document not accessible");
    return doc;
  }
}
