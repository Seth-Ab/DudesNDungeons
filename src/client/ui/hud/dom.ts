export function createStat(label: string, initialValue: string) {
  const element = document.createElement("div");
  element.className = "hud__stat";

  const value = document.createElement("span");
  value.textContent = initialValue;
  element.textContent = `${label}: `;
  element.append(value);

  return { element, value };
}

export function createButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

/** A paragraph that is hidden while it has nothing to say. */
export function createLine(className: string) {
  const element = document.createElement("p");
  element.className = className;
  element.hidden = true;

  return {
    element,
    set(text: string) {
      element.textContent = text;
      element.hidden = text === "";
    },
  };
}
