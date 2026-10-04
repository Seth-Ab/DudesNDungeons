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
  };
}

function toastElement(toast: Toast): HTMLElement {
  const element = document.createElement("p");
  element.className = `hud__toast hud__toast--${toast.severity}`;
  element.textContent = toast.text;
  return element;
}
