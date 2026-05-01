import type {
  TrialRecording,
  SessionRecording,
  StylesheetEvent,
} from "../schema/types.js";
import { ReplayEngine } from "../replay/engine.js";
import { ViewportManager } from "../replay/viewport.js";
import {
  instantiateDom,
  installStylesheet,
  updateStylesheet,
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

  // UI elements
  private readonly playPauseBtn: HTMLButtonElement;
  private readonly restartBtn: HTMLButtonElement;
  private readonly prevBtn: HTMLButtonElement;
  private readonly nextBtn: HTMLButtonElement;
  private readonly scrubBar: HTMLInputElement;
  private readonly timeDisplay: HTMLElement;
  private readonly speedSelect: HTMLSelectElement;
  private readonly trialSelect: HTMLSelectElement;

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
      trialSelect: HTMLSelectElement;
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
    this.trialSelect = elements.trialSelect;

    this.bindEvents();
    this.populateTrialSelect();
  }

  private bindEvents(): void {
    this.playPauseBtn.addEventListener("click", () => this.togglePlayPause());
    this.restartBtn.addEventListener("click", () => this.restartCurrentTrial());
    this.prevBtn.addEventListener("click", () => this.jumpTrial(-1));
    this.nextBtn.addEventListener("click", () => this.jumpTrial(1));

    this.trialSelect.addEventListener("change", () => {
      const idx = Number(this.trialSelect.value);
      this.selectTrial(idx);
    });

    this.speedSelect.addEventListener("change", () => {
      this.speed = Number(this.speedSelect.value);
      if (this.engine?.isPlaying()) {
        const elapsed = this.engine.currentElapsed();
        const trial = this.currentTrial();
        if (!trial) return;
        const duration = this.trialDuration(trial);
        this.engine.cancelAll();
        this.engine.scheduleEvents(trial.events, duration, elapsed, this.speed);
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
  }

  private populateTrialSelect(): void {
    this.trialSelect.innerHTML = "";
    for (let i = 0; i < this.trials.length; i++) {
      const t = this.trials[i];
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = `Trial ${t.trial_index}: ${t.plugin || "?"}`;
      this.trialSelect.appendChild(opt);
    }
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
    this.trialSelect.value = String(listIndex);

    const trial = this.trials[listIndex];

    // Apply viewport at trial start
    if (trial.t_start != null) {
      this.viewport.applyViewportAt(trial.t_start);
    } else {
      this.viewport.applyViewport(this.recording.viewport);
    }

    // Reset and rebuild stylesheets up to the trial start
    this.resetStylesheetsAt(trial.t_start ?? 0);

    // Reconstruct initial DOM
    this.currentIdMap = new Map();
    const container = this.viewport.clearContent();

    if (trial.initial_dom !== null) {
      instantiateDom(trial.initial_dom, container, this.currentIdMap, this.viewport.iframeDoc);
    }

    // Set up engine
    this.engine = new ReplayEngine(
      this.viewport.iframeDoc,
      this.currentIdMap,
      {
        overlay: this.overlay,
        onComplete: () => {
          this.setPlayPauseIcon(false);
        },
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

  private trialDuration(trial: TrialRecording): number {
    if (trial.t_dom_ready == null || trial.t_end == null) return 0;
    return trial.t_end - trial.t_dom_ready;
  }

  /**
   * Tear down any installed stylesheets, then reinstall the recording's
   * initial snapshot and replay every session-level stylesheet event with
   * `t <= upToT`. Used at trial selection / seek so the iframe matches the
   * stylesheet state recorded at that point in the session.
   *
   * Mid-trial stylesheet events (t_dom_ready < t < t_end) are applied here
   * but not yet scheduled across trial playback time.
   */
  private resetStylesheetsAt(upToT: number): void {
    const doc = this.viewport.iframeDoc;
    for (const id of Array.from(this.currentSheetMap.keys())) {
      removeStylesheet(id, this.currentSheetMap);
    }

    for (const sheet of this.recording.stylesheets ?? []) {
      installStylesheet(sheet, doc, this.currentSheetMap);
    }

    const events: StylesheetEvent[] = this.recording.stylesheet_events ?? [];
    for (const ev of events) {
      if (ev.t > upToT) break;
      this.applyStylesheetEvent(ev);
    }
  }

  private applyStylesheetEvent(ev: StylesheetEvent): void {
    switch (ev.type) {
      case "stylesheet.add":
        installStylesheet(ev.sheet, this.viewport.iframeDoc, this.currentSheetMap);
        break;
      case "stylesheet.update":
        updateStylesheet(ev.id, ev.css, this.currentSheetMap);
        break;
      case "stylesheet.remove":
        removeStylesheet(ev.id, this.currentSheetMap);
        break;
    }
  }

  private currentTrial(): TrialRecording | null {
    return this.trials[this.currentListIndex] ?? null;
  }

  private togglePlayPause(): void {
    if (!this.engine) return;
    const trial = this.currentTrial();
    if (!trial) return;
    const duration = this.trialDuration(trial);

    if (this.engine.isPlaying()) {
      this.engine.pause();
      this.setPlayPauseIcon(false);
    } else {
      const elapsed = this.engine.currentElapsed();
      // If at end, restart
      const from = elapsed >= duration ? 0 : elapsed;
      if (from === 0) {
        this.selectTrial(this.currentListIndex);
        this.engine!.scheduleEvents(trial.events, duration, 0, this.speed);
      } else {
        this.engine.scheduleEvents(trial.events, duration, from, this.speed);
      }
      this.setPlayPauseIcon(true);
    }
  }

  private restartCurrentTrial(): void {
    const trial = this.currentTrial();
    if (!trial) return;
    this.selectTrial(this.currentListIndex);
    const duration = this.trialDuration(trial);
    this.engine!.scheduleEvents(trial.events, duration, 0, this.speed);
    this.setPlayPauseIcon(true);
  }

  private jumpTrial(delta: number): void {
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

    // Reset stylesheets to the state at trial-start (mid-trial stylesheet
    // changes are not yet replayed — see selectTrial)
    this.resetStylesheetsAt(trial.t_start ?? 0);

    // Re-instantiate initial DOM
    this.currentIdMap = new Map();
    const container = this.viewport.clearContent();
    if (trial.initial_dom !== null) {
      instantiateDom(trial.initial_dom, container, this.currentIdMap, this.viewport.iframeDoc);
    }

    // Re-create engine with fresh id map
    this.engine = new ReplayEngine(
      this.viewport.iframeDoc,
      this.currentIdMap,
      {
        overlay: this.overlay,
        onComplete: () => this.setPlayPauseIcon(false),
        onTick: (elapsed) => {
          this.updateScrub(elapsed, duration);
          this.callbacks.onTick(elapsed, duration);
        },
      },
      this.currentSheetMap
    );

    // Apply all events up to the seek target synchronously
    this.engine.applyEventsSync(trial.events, clamped);

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
