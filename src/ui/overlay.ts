/**
 * Overlay controller: cursor dot and keystroke indicator rendered on top of
 * the iframe stage.
 */
export interface OverlayController {
  moveCursor(x: number, y: number): void;
  showClick(): void;
  showKey(label: string): void;
  setBlurred(blurred: boolean): void;
  hide(): void;
  show(): void;
}

const MAX_KEYS = 3;
const KEY_DISPLAY_MS = 1000;

export function createOverlay(
  cursorEl: HTMLElement,
  keystrokeEl: HTMLElement,
  focusOverlayEl: HTMLElement
): OverlayController {
  let clickTimeout: ReturnType<typeof setTimeout> | null = null;

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
      // Remove excess badges
      while (keystrokeEl.children.length >= MAX_KEYS) {
        keystrokeEl.removeChild(keystrokeEl.firstChild!);
      }
      const badge = document.createElement("div");
      badge.className = "key-badge";
      badge.textContent = label;
      keystrokeEl.appendChild(badge);

      // Auto-remove after animation
      setTimeout(() => {
        if (badge.parentNode === keystrokeEl) {
          keystrokeEl.removeChild(badge);
        }
      }, KEY_DISPLAY_MS);
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
      keystrokeEl.innerHTML = "";
      focusOverlayEl.classList.remove("visible");
    },

    show() {
      // cursor visibility is controlled by moveCursor; nothing to do here
    },
  };
}
