import type { SessionRecording, ViewportState } from "../schema/types.js";

/**
 * Manage the replay iframe: sizing, document preparation, viewport changes.
 */
export class ViewportManager {
  private readonly iframe: HTMLIFrameElement;
  private readonly recording: SessionRecording;

  constructor(iframe: HTMLIFrameElement, recording: SessionRecording) {
    this.iframe = iframe;
    this.recording = recording;
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
    this.iframe.width = String(vp.w);
    this.iframe.height = String(vp.h);
    const wrapper = this.iframe.parentElement;
    if (wrapper) {
      wrapper.style.width = `${vp.w}px`;
      wrapper.style.height = `${vp.h}px`;
    }
  }

  /**
   * Apply the viewport that was active at time `t` for the given trial.
   */
  applyViewportAt(t: number): void {
    this.applyViewport(this.viewportAt(t));
  }

  /**
   * Ensure the iframe document is ready and contains #jspsych-content.
   * Returns the container element.
   */
  ensureContent(): HTMLElement {
    const doc = this.iframe.contentDocument;
    if (!doc) throw new Error("iframe document not accessible");

    // Write a minimal HTML shell if the document is empty
    if (!doc.getElementById("jspsych-content")) {
      doc.open();
      doc.write(`<!doctype html>
<html>
<head>
<meta charset="UTF-8"/>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 0; font-family: sans-serif; }
  #jspsych-content { min-height: 100%; }
</style>
</head>
<body><div id="jspsych-content"></div></body>
</html>`);
      doc.close();
    }

    return doc.getElementById("jspsych-content") as HTMLElement;
  }

  /**
   * Clear #jspsych-content and return the empty container.
   */
  clearContent(): HTMLElement {
    const container = this.ensureContent();
    container.innerHTML = "";
    return container;
  }

  get iframeDoc(): Document {
    const doc = this.iframe.contentDocument;
    if (!doc) throw new Error("iframe document not accessible");
    return doc;
  }
}
