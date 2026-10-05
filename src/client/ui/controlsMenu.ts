import { keyLabel } from "../input/keyBindings.js";
import type { HudSettingsStore } from "../state/hudSettings.js";
import { createHudSettingsSection } from "./hudSettings.js";

interface ControlGroup {
  title: string;
  controls: { input: string; action: string }[];
}

const CONTROL_GROUPS: ControlGroup[] = [
  {
    title: "Movement",
    controls: [
      { input: "W A S D", action: "Move" },
      { input: "Arrow Keys", action: "Move" },
    ],
  },
  {
    title: "Dungeon",
    controls: [
      { input: keyLabel("attack"), action: "Attack (costs stamina)" },
      { input: keyLabel("pickup"), action: "Pick up nearby loot" },
      { input: keyLabel("interact"), action: "Interact with doors and exits" },
      { input: keyLabel("carry"), action: "Carry a downed party member, or drop who you're carrying" },
      { input: `${keyLabel("useSlot1")} / ${keyLabel("useSlot2")} / ${keyLabel("useSlot3")}`, action: "Use inventory slot" },
    ],
  },
  {
    title: "The Hub",
    controls: [
      { input: keyLabel("pickup"), action: "Take a torch from the Torch Supply" },
      { input: keyLabel("interact"), action: "Use the Dungeon Gate to start a run" },
      { input: "Ready", action: "Required from every member before the gate opens" },
    ],
  },
  {
    title: "Party",
    controls: [
      { input: "Ready", action: "Toggle ready state" },
      { input: "Enable Voice", action: "Request microphone preview" },
      { input: "Leave", action: "Exit the current room" },
    ],
  },
  {
    title: "Debug",
    controls: [{ input: "`", action: "Show or hide the position readout" }],
  },
];

export function createControlsMenu(settingsStore: HudSettingsStore) {
  const element = document.createElement("div");
  element.className = "controls-menu";
  element.hidden = true;

  const panel = document.createElement("section");
  panel.className = "controls-menu__panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-labelledby", "controls-menu-title");

  const heading = document.createElement("h2");
  heading.id = "controls-menu-title";
  heading.textContent = "Controls";

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "controls-menu__close";
  closeButton.textContent = "Close";

  const header = document.createElement("div");
  header.className = "controls-menu__header";
  header.append(heading, closeButton);

  const groups = document.createElement("div");
  groups.className = "controls-menu__groups";
  groups.append(...CONTROL_GROUPS.map(renderGroup), createHudSettingsSection(settingsStore).element);

  panel.append(header, groups);
  element.append(panel);

  function open(): void {
    element.hidden = false;
    closeButton.focus();
  }

  function close(): void {
    element.hidden = true;
  }

  element.addEventListener("click", (event) => {
    if (event.target === element) close();
  });
  closeButton.addEventListener("click", close);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !element.hidden) close();
  });

  return { element, open, close };
}

function renderGroup(group: ControlGroup): HTMLElement {
  const section = document.createElement("section");
  section.className = "controls-menu__group";

  const heading = document.createElement("h3");
  heading.textContent = group.title;

  const list = document.createElement("dl");
  list.className = "controls-menu__list";

  for (const control of group.controls) {
    const input = document.createElement("dt");
    input.textContent = control.input;

    const action = document.createElement("dd");
    action.textContent = control.action;

    list.append(input, action);
  }

  section.append(heading, list);
  return section;
}
