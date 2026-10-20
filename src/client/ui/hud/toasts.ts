import type { ToastMessage } from "../../state/hudView.js";
import { createToastQueue, type Toast } from "../../state/toastQueue.js";

const EXPIRY_CHECK_MS = 500;

/** The single stack of auto-expiring messages at the top centre of the screen. */
export function createToasts(now: () => number = () => performance.now()) {
  const queue = createToastQueue();

  const element = document.createElement("div");
  element.className = "hud__toasts";
  element.setAttribute("role", "status");
  element.setAttribute("aria-live", "polite");

  const render = (): void => {
    element.replaceChildren(...queue.visible().map(toastElement));
  };

  setInterval(() => {
    if (queue.expire(now())) render();
  }, EXPIRY_CHECK_MS);

  return {
    element,

    update(messages: readonly ToastMessage[]) {
      const time = now();
      let changed = queue.expire(time);
      for (const message of messages) {
        changed = queue.show(message.key, message.text, message.severity, time, message.ttlMs) || changed;
      }
      if (changed) render();
    },

    /**
     * A one-off message, such as the outcome of the player's last action. It shows again even when
     * the text repeats, so pressing pickup twice with nothing nearby answers twice.
     */
    say(key: string, text: string, severity: ToastMessage["severity"] = "info") {
      const time = now();
      queue.expire(time);
      queue.clear(key);
      queue.show(key, text, severity, time);
      render();
    },
  };
}

/**
 * The top-centre column every notice shares: the hub banner first, then the toasts, so the two
 * stack in one flow and can never be positioned over each other.
 */
export function createNoticeStack(...cards: HTMLElement[]): HTMLElement {
  const element = document.createElement("div");
  element.className = "hud__notices";
  element.append(...cards);
  return element;
}

function toastElement(toast: Toast): HTMLElement {
  const element = document.createElement("p");
  element.className = `hud__toast hud__toast--${toast.severity}`;
  element.textContent = toast.text;
  return element;
}
