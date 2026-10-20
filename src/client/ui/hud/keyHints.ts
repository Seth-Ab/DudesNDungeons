import { onBindingsChange } from "../../input/keyBindings.js";
import { keyHints } from "../../state/hudView.js";

interface KeyHintOptions {
  onOpenCamp: () => void;
}

/**
 * One line of key hints. The first, Esc for the camp menu, is also a button, so a touch player with
 * no Escape key can still reach the menu. The rest follow rebinding.
 */
export function createKeyHints(options: KeyHintOptions) {
  const element = document.createElement("section");
  element.className = "hud__panel hud__panel--hints";
  element.setAttribute("aria-label", "Key hints");

  const render = (): void => {
    const [camp, ...rest] = keyHints();
    const campButton = document.createElement("button");
    campButton.type = "button";
    campButton.className = "hud__hint hud__hint--camp";
    campButton.setAttribute("aria-haspopup", "dialog");
    campButton.setAttribute("aria-label", "Open the camp menu (Esc)");
    campButton.append(hintParts(camp!));
    campButton.addEventListener("click", options.onOpenCamp);

    element.replaceChildren(
      campButton,
      ...rest.map((hint) => {
        const item = document.createElement("span");
        item.className = "hud__hint";
        item.append(hintParts(hint));
        return item;
      }),
    );
  };

  render();
  onBindingsChange(render);

  return { element };
}

function hintParts(hint: { key: string; label: string }): DocumentFragment {
  const fragment = document.createDocumentFragment();
  const key = document.createElement("kbd");
  key.textContent = hint.key;
  fragment.append(key, ` ${hint.label}`);
  return fragment;
}
