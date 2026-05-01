import type { TrialRecording } from "../schema/types.js";

export interface SidebarCallbacks {
  onTrialSelect: (index: number) => void;
}

/**
 * Renders the trial list in the sidebar and manages trial selection.
 */
export class Sidebar {
  private readonly listEl: HTMLElement;
  private readonly dataContentEl: HTMLElement;
  private readonly callbacks: SidebarCallbacks;
  private trials: TrialRecording[] = [];

  constructor(listEl: HTMLElement, dataContentEl: HTMLElement, callbacks: SidebarCallbacks) {
    this.listEl = listEl;
    this.dataContentEl = dataContentEl;
    this.callbacks = callbacks;
  }

  setTrials(trials: TrialRecording[]): void {
    this.trials = trials;
    this.renderList();
  }

  private renderList(): void {
    this.listEl.innerHTML = "";
    for (let i = 0; i < this.trials.length; i++) {
      const trial = this.trials[i];
      const item = document.createElement("div");
      item.className = "trial-item";
      item.dataset["index"] = String(i);

      const indexSpan = document.createElement("span");
      indexSpan.className = "trial-index";
      indexSpan.textContent = `#${trial.trial_index}`;

      const pluginSpan = document.createElement("span");
      pluginSpan.className = "trial-plugin";
      pluginSpan.textContent = trial.plugin || "(unknown plugin)";

      item.appendChild(indexSpan);
      item.appendChild(pluginSpan);

      item.addEventListener("click", () => {
        this.setActive(i);
        this.callbacks.onTrialSelect(i);
      });

      this.listEl.appendChild(item);
    }
  }

  setActive(listIndex: number): void {
    for (const item of this.listEl.querySelectorAll<HTMLElement>(".trial-item")) {
      const idx = Number(item.dataset["index"]);
      item.classList.toggle("active", idx === listIndex);
    }
    // Update trial data viewer
    if (listIndex >= 0 && listIndex < this.trials.length) {
      const trial = this.trials[listIndex];
      this.dataContentEl.textContent = JSON.stringify(trial.trial_data, null, 2);
    } else {
      this.dataContentEl.textContent = "(select a trial)";
    }
  }

  scrollToActive(): void {
    const active = this.listEl.querySelector<HTMLElement>(".trial-item.active");
    if (active) {
      active.scrollIntoView({ block: "nearest" });
    }
  }
}
