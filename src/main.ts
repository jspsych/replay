import { validate } from "./schema/types.js";
import type { SessionRecording } from "./schema/types.js";
import { Sidebar } from "./ui/sidebar.js";
import { Player } from "./ui/player.js";
import { ViewportManager } from "./replay/viewport.js";
import { createOverlay } from "./ui/overlay.js";

// ── DOM element references ──────────────────────────────────────────────────

const loadBtn = document.getElementById("load-btn") as HTMLButtonElement;
const fileInput = document.getElementById("file-input") as HTMLInputElement;
const errorBanner = document.getElementById("error-banner") as HTMLDivElement;
const trialListEl = document.getElementById("trial-list") as HTMLDivElement;
const trialDataContentEl = document.getElementById("trial-data-content") as HTMLPreElement;
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

// ── State ───────────────────────────────────────────────────────────────────

let player: Player | null = null;
let sidebar: Sidebar | null = null;

// ── Event wiring ─────────────────────────────────────────────────────────────

loadBtn.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  loadFile(file);
  // Reset so the same file can be re-loaded
  fileInput.value = "";
});

// Drag and drop support
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files[0];
  if (file) loadFile(file);
});

// ── File loading ──────────────────────────────────────────────────────────────

function loadFile(file: File): void {
  clearError();
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const recording = validate(reader.result as string);
      initReplay(recording);
    } catch (err) {
      showError((err as Error).message);
    }
  };
  reader.onerror = () => showError("Failed to read file");
  reader.readAsText(file);
}

function initReplay(recording: SessionRecording): void {
  // Stop any current playback
  player?.stop();

  // Mark body as loaded
  document.body.classList.add("has-recording");

  // Ensure iframe is ready
  const vp = new ViewportManager(replayFrame, recording);
  vp.ensureContent();

  // Overlay
  const overlay = createOverlay(cursorDot, keystrokeIndicator, focusOverlayEl);

  // Sidebar
  sidebar = new Sidebar(trialListEl, trialDataContentEl, {
    onTrialSelect: (idx) => {
      player?.selectTrial(idx);
      sidebar?.setActive(idx);
      sidebar?.scrollToActive();
    },
  });
  sidebar.setTrials(recording.trials);

  // Player
  player = new Player(recording, vp, overlay, {
    onTrialChange: (idx) => {
      sidebar?.setActive(idx);
      sidebar?.scrollToActive();
    },
    onTick: (_elapsed, _duration) => {
      // Additional tick handling if needed
    },
  }, {
    playPauseBtn,
    restartBtn,
    prevBtn: prevTrialBtn,
    nextBtn: nextTrialBtn,
    scrubBar,
    timeDisplay,
    speedSelect,
    trialSelect,
  });

  // Auto-select first trial if available
  if (recording.trials.length > 0) {
    player.selectTrial(0);
    sidebar.setActive(0);
  }
}

// ── Error display ─────────────────────────────────────────────────────────────

function showError(msg: string): void {
  errorBanner.textContent = `Error: ${msg}`;
  errorBanner.style.display = "block";
}

function clearError(): void {
  errorBanner.textContent = "";
  errorBanner.style.display = "none";
}

// ── Try loading sample recording if available ─────────────────────────────────

async function tryLoadSample(): Promise<void> {
  try {
    const resp = await fetch("./examples/sample-recording.json");
    if (!resp.ok) return;
    const text = await resp.text();
    const recording = validate(text);
    initReplay(recording);
  } catch {
    // Sample not available; user will load manually
  }
}

tryLoadSample();
