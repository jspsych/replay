import { validate } from "./schema/types.js";
import type { SessionRecording } from "./schema/types.js";
import { Sidebar } from "./ui/sidebar.js";
import { Player } from "./ui/player.js";
import { ViewportManager } from "./replay/viewport.js";
import { createOverlay } from "./ui/overlay.js";

// ── DOM element references ──────────────────────────────────────────────────

const loadBtn = document.getElementById("load-btn") as HTMLButtonElement;
const welcomeLoadBtn = document.getElementById("welcome-load-btn") as HTMLButtonElement;
const fileInput = document.getElementById("file-input") as HTMLInputElement;
const errorBanner = document.getElementById("error-banner") as HTMLDivElement;
const headerMeta = document.getElementById("header-meta") as HTMLSpanElement;
const trialListEl = document.getElementById("trial-list") as HTMLDivElement;
const trialCountEl = document.getElementById("trial-count") as HTMLSpanElement;
const trialDataContentEl = document.getElementById("trial-data-content") as HTMLPreElement;
const trialDataMetaEl = document.getElementById("trial-data-meta") as HTMLSpanElement;
const replayFrame = document.getElementById("replay-frame") as HTMLIFrameElement;
const cursorDot = document.getElementById("cursor-dot") as HTMLDivElement;
const keystrokeIndicator = document.getElementById("keystroke-indicator") as HTMLDivElement;
const focusOverlayEl = document.getElementById("focus-overlay") as HTMLDivElement;

const playPauseBtn = document.getElementById("play-pause-btn") as HTMLButtonElement;
const restartBtn = document.getElementById("restart-btn") as HTMLButtonElement;
const prevTrialBtn = document.getElementById("prev-trial-btn") as HTMLButtonElement;
const nextTrialBtn = document.getElementById("next-trial-btn") as HTMLButtonElement;
const scrubBar = document.getElementById("scrub-bar") as HTMLInputElement;
const timeDisplay = document.getElementById("time-display") as HTMLSpanElement;
const speedSelect = document.getElementById("speed-select") as HTMLSelectElement;
const trialSelect = document.getElementById("trial-select") as HTMLSelectElement;
const autoplayCheckbox = document.getElementById("autoplay-checkbox") as HTMLInputElement;

const labelTrialEl = document.getElementById("label-trial") as HTMLSpanElement;
const labelPluginEl = document.getElementById("label-plugin") as HTMLSpanElement;
const labelDimEl = document.getElementById("label-dim") as HTMLSpanElement;
const labelScaleEl = document.getElementById("label-scale") as HTMLSpanElement;
const stageContainer = document.getElementById("stage-container") as HTMLDivElement;

// ── State ───────────────────────────────────────────────────────────────────

let player: Player | null = null;
let sidebar: Sidebar | null = null;
let currentRecording: SessionRecording | null = null;
let viewportManager: ViewportManager | null = null;

// Recompute stage scale whenever the stage container resizes (window resize,
// sidebar layout shifts, dev tools open, etc).
const stageResizeObserver = new ResizeObserver(() => viewportManager?.refit());
stageResizeObserver.observe(stageContainer);
window.addEventListener("resize", () => viewportManager?.refit());

// ── Event wiring ─────────────────────────────────────────────────────────────

loadBtn.addEventListener("click", () => fileInput.click());
welcomeLoadBtn.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  loadFile(file);
  fileInput.value = "";
});

// Drag and drop, with a full-window drop indicator
let dragDepth = 0;
document.addEventListener("dragenter", (e) => {
  if (!e.dataTransfer?.types.includes("Files")) return;
  dragDepth++;
  document.body.classList.add("drag-over");
});
document.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) document.body.classList.remove("drag-over");
});
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove("drag-over");
  const file = e.dataTransfer?.files[0];
  if (file) loadFile(file);
});

// Keyboard shortcuts (only when not typing in a form control)
document.addEventListener("keydown", (e) => {
  const target = e.target as HTMLElement | null;
  const tag = target?.tagName.toLowerCase();
  const inField =
    tag === "input" || tag === "textarea" || tag === "select" || target?.isContentEditable;

  // Open file is allowed even before a recording is loaded
  if ((e.key === "o" || e.key === "O") && !e.metaKey && !e.ctrlKey && !inField) {
    e.preventDefault();
    fileInput.click();
    return;
  }
  if ((e.key === "o" || e.key === "O") && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    fileInput.click();
    return;
  }

  if (!player || inField) return;

  switch (e.key) {
    case " ":
    case "Spacebar":
      e.preventDefault();
      player.togglePlayPause();
      break;
    case "ArrowLeft":
      e.preventDefault();
      player.jumpTrial(-1);
      break;
    case "ArrowRight":
      e.preventDefault();
      player.jumpTrial(1);
      break;
    case "r":
    case "R":
      e.preventDefault();
      player.restartCurrentTrial();
      break;
  }
});

// ── File loading ──────────────────────────────────────────────────────────────

function loadFile(file: File): void {
  clearError();
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const recording = validate(reader.result as string);
      initReplay(recording, file.name);
    } catch (err) {
      showError((err as Error).message);
    }
  };
  reader.onerror = () => showError("Failed to read file");
  reader.readAsText(file);
}

function initReplay(recording: SessionRecording, fileName: string): void {
  player?.stop();
  currentRecording = recording;

  document.body.classList.add("has-recording");

  // Header meta line
  const startedAt = recording.recording_started_at
    ? new Date(recording.recording_started_at).toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
  headerMeta.textContent = [fileName, `${recording.trials.length} trials`, startedAt]
    .filter(Boolean)
    .join("  ·  ");

  // Trial count in sidebar header
  trialCountEl.textContent = String(recording.trials.length);

  const vp = new ViewportManager(replayFrame, recording, stageContainer, (scale) => {
    labelScaleEl.textContent = `${Math.round(scale * 100)}%`;
  });
  vp.ensureShell();
  viewportManager = vp;

  const overlay = createOverlay(cursorDot, keystrokeIndicator, focusOverlayEl);

  sidebar = new Sidebar(trialListEl, trialDataContentEl, {
    onTrialSelect: (idx) => {
      player?.selectTrial(idx);
      sidebar?.setActive(idx);
      sidebar?.scrollToActive();
    },
  });
  sidebar.setTrials(recording.trials);

  player = new Player(
    recording,
    vp,
    overlay,
    {
      onTrialChange: (idx) => {
        sidebar?.setActive(idx);
        sidebar?.scrollToActive();
        updateStageLabel(idx);
        updateTrialDataMeta(idx);
      },
      onTick: () => {},
    },
    {
      playPauseBtn,
      restartBtn,
      prevBtn: prevTrialBtn,
      nextBtn: nextTrialBtn,
      scrubBar,
      timeDisplay,
      speedSelect,
      trialSelect,
      autoplayCheckbox,
    }
  );

  if (recording.trials.length > 0) {
    player.selectTrial(0);
    sidebar.setActive(0);
  }
}

function updateStageLabel(idx: number): void {
  if (!currentRecording) return;
  const trial = currentRecording.trials[idx];
  if (!trial) return;
  labelTrialEl.textContent = `Trial ${trial.trial_index}`;
  labelPluginEl.textContent = trial.plugin || "—";
  const vp = currentRecording.viewport;
  labelDimEl.textContent = `${vp.w} × ${vp.h}`;
}

function updateTrialDataMeta(idx: number): void {
  if (!currentRecording) return;
  const trial = currentRecording.trials[idx];
  if (!trial) return;
  const dur =
    trial.t_end != null && trial.t_dom_ready != null
      ? `${((trial.t_end - trial.t_dom_ready) / 1000).toFixed(2)} s`
      : "—";
  trialDataMetaEl.textContent = `${trial.plugin}  ·  ${dur}`;
}

// ── Error display ─────────────────────────────────────────────────────────────

function showError(msg: string): void {
  errorBanner.textContent = msg;
  errorBanner.style.display = "block";
}

function clearError(): void {
  errorBanner.textContent = "";
  errorBanner.style.display = "none";
}
