import type { ConvertPromptView } from "../../state/convertPrompt.js";

interface ConvertPromptOptions {
  onConfirm: (itemId: string) => void;
  onCancel: () => void;
}

/**
 * The confirmation shown when a scroll's skill is already maxed. Confirm sends the one conversion
 * intent; Cancel only closes it. The server re-checks the scroll and the skill either way.
 */
export function createConvertPrompt(options: ConvertPromptOptions) {
  const heading = document.createElement("p");
  heading.className = "hud__stash-heading";

  const reminder = document.createElement("p");
  reminder.className = "hud__stash-hint";

  const confirmButton = document.createElement("button");
  confirmButton.type = "button";
  const cancelButton = document.createElement("button");
  cancelButton.type = "button";
  cancelButton.textContent = "Cancel";

  const buttons = document.createElement("div");
  buttons.className = "hud__stash-header";
  buttons.append(confirmButton, cancelButton);

  const panel = document.createElement("section");
  panel.className = "hud__panel hud__vault hud__convert";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Convert scroll");
  panel.hidden = true;
  panel.append(heading, reminder, buttons);

  let itemId: string | null = null;
  confirmButton.addEventListener("click", () => {
    if (itemId !== null) options.onConfirm(itemId);
  });
  cancelButton.addEventListener("click", options.onCancel);

  return {
    panel,

    isOpen: () => !panel.hidden,

    update(view: ConvertPromptView | null) {
      const wasOpen = !panel.hidden;
      panel.hidden = view === null;
      itemId = view?.itemId ?? null;
      if (!view) return;

      heading.textContent = view.scrollName;
      reminder.textContent = view.reminder;
      confirmButton.textContent = view.text;
      if (!wasOpen) confirmButton.focus();
    },
  };
}
