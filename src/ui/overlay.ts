/**
 * Overlay controller: cursor dot and keystroke indicator rendered on top of
 * the iframe stage.
 */
export interface OverlayController {
  moveCursor(x: number, y: number): void;
  showClick(): void;
  showKey(label: string): void;
  /** Show a non-key annotation badge (e.g. fullscreen enter/exit). */
  showEvent(label: string): void;
  setBlurred(blurred: boolean): void;
  hide(): void;
  show(): void;
}

const MAX_BADGES = 3;
const BADGE_DISPLAY_MS = 1000;
const EVENT_DISPLAY_MS = 1500;

export function createOverlay(
  cursorEl: HTMLElement,
  keystrokeEl: HTMLElement,
  focusOverlayEl: HTMLElement
): OverlayController {
  let clickTimeout: ReturnType<typeof setTimeout> | null = null;

  function addBadge(container: HTMLElement, label: string, className: string, ttl: number) {
    while (container.children.length >= MAX_BADGES) {
      container.removeChild(container.firstChild!);
    }
    const badge = document.createElement("div");
    badge.className = className;
    badge.textContent = label;
    container.appendChild(badge);
    setTimeout(() => {
      if (badge.parentNode === container) {
        container.removeChild(badge);
      }
    }, ttl);
  }

  return {
    moveCursor(x: number, y: number) {
      cursorEl.style.display = "block";
      cursorEl.style.left = `${x}px`;
      cursorEl.style.top = `${y}px`;
    },

    showClick() {
      cursorEl.classList.add("click");
      if (clickTimeout !== null) clearTimeout(clickTimeout);
      clickTimeout = setTimeout(() => {
        cursorEl.classList.remove("click");
        clickTimeout = null;
      }, 200);
    },

    showKey(label: string) {
      addBadge(keystrokeEl, label, "key-badge", BADGE_DISPLAY_MS);
    },

    showEvent(label: string) {
      addBadge(keystrokeEl, label, "event-badge", EVENT_DISPLAY_MS);
    },

    setBlurred(blurred: boolean) {
      if (blurred) {
        focusOverlayEl.classList.add("visible");
      } else {
        focusOverlayEl.classList.remove("visible");
      }
    },

    hide() {
      cursorEl.style.display = "none";
      // Don't clear key badges: each one self-removes after KEY_DISPLAY_MS
      // via its own setTimeout in showKey. Letting them ride lets the
      // keystroke that ended a trial stay visible across an auto-advance
      // boundary instead of getting wiped when the next trial mounts.
      focusOverlayEl.classList.remove("visible");
    },

    show() {
      // cursor visibility is controlled by moveCursor; nothing to do here
    },
  };
}
