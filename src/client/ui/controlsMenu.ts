import {
  ACTION_NAMES,
  bindingMessage,
  DEBUG_KEY,
  keyLabel,
  onBindingsChange,
  resetBindings,
  setBinding,
  type BindableAction,
} from "../input/keyBindings.js";
import type { HudSettingsStore } from "../state/hudSettings.js";
import { createHudSettingsSection } from "./hudSettings.js";

/** A row's key cell: `rebind` names the action whose binding it edits, none for read-only text. */
interface ControlRow {
  input: () => string;
  action: string;
  rebind?: BindableAction;
}

interface ControlGroup {
  title: string;
  controls: ControlRow[];
}

const bound = (action: BindableAction) => (): string => keyLabel(action);

const CONTROL_GROUPS: ControlGroup[] = [
  {
    title: "Movement",
    controls: [
      { input: bound("moveNorth"), action: ACTION_NAMES.moveNorth, rebind: "moveNorth" },
      { input: bound("moveWest"), action: ACTION_NAMES.moveWest, rebind: "moveWest" },
      { input: bound("moveSouth"), action: ACTION_NAMES.moveSouth, rebind: "moveSouth" },
      { input: bound("moveEast"), action: ACTION_NAMES.moveEast, rebind: "moveEast" },
      { input: () => "Arrow Keys", action: "Move (always available)" },
    ],
  },
  {
    title: "Dungeon",
    controls: [
      { input: bound("attack"), action: "Attack (costs stamina)", rebind: "attack" },
      { input: bound("pickup"), action: "Pick up nearby loot", rebind: "pickup" },
      { input: bound("interact"), action: "Interact with doors and exits", rebind: "interact" },
      {
        input: bound("carry"),
        action: "Carry a downed party member, or drop who you're carrying",
        rebind: "carry",
      },
      {
        input: bound("drop"),
        action: "Drop the selected item (the last slot you used) at your feet",
        rebind: "drop",
      },
      {
        input: bound("give"),
        action: "Give the selected item to a nearby party member",
        rebind: "give",
      },
      { input: bound("useSlot1"), action: "Use inventory slot 1", rebind: "useSlot1" },
      { input: bound("useSlot2"), action: "Use inventory slot 2", rebind: "useSlot2" },
      { input: bound("useSlot3"), action: "Use inventory slot 3", rebind: "useSlot3" },
    ],
  },
  {
    title: "Interface",
    controls: [
      {
        input: bound("toggleMinimap"),
        action: "Show or hide the minimap (it starts shown in each new world)",
        rebind: "toggleMinimap",
      },
    ],
  },
  {
    title: "The Hub",
    controls: [
      { input: bound("pickup"), action: "Take a torch from the Torch Supply" },
      { input: bound("interact"), action: "Use the Dungeon Gate to start a run" },
      { input: () => "Ready", action: "Required from every member before the gate opens" },
    ],
  },
  {
    title: "Party",
    controls: [
      { input: () => "Ready", action: "Toggle ready state" },
      { input: () => "Enable Voice", action: "Talk to nearby party members you can see" },
      { input: () => "Mute", action: "Stop sending your microphone" },
      { input: () => "Deafen", action: "Silence everyone, and mute yourself" },
      { input: () => "Leave", action: "Exit the current room" },
    ],
  },
  {
    title: "Debug",
    controls: [{ input: () => DEBUG_KEY, action: "Show or hide the position readout" }],
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
  const message = document.createElement("p");
  message.className = "controls-menu__message";
  message.setAttribute("role", "status");
  message.hidden = true;

  const resetButton = document.createElement("button");
  resetButton.type = "button";
  resetButton.className = "controls-menu__reset";
  resetButton.textContent = "Reset to defaults";

  // The key being chosen for an action, or null. While set, `onCapture` swallows every keypress.
  let capturing: { action: BindableAction; button: HTMLButtonElement } | null = null;

  const showMessage = (text: string): void => {
    message.textContent = text;
    message.hidden = text === "";
  };

  const refreshers: (() => void)[] = [];
  const renderBinding = (button: HTMLButtonElement, action: BindableAction): void => {
    const active = capturing?.action === action;
    button.textContent = active ? "Press a key..." : keyLabel(action);
    button.setAttribute("aria-label", `${ACTION_NAMES[action]}: ${active ? "press a key" : keyLabel(action)}`);
    button.classList.toggle("controls-menu__key--capturing", active);
  };

  const endCapture = (): void => {
    const was = capturing;
    capturing = null;
    if (was) renderBinding(was.button, was.action);
  };

  groups.append(
    ...CONTROL_GROUPS.map((group) =>
      renderGroup(group, refreshers, (action, button) => {
        endCapture();
        capturing = { action, button };
        showMessage("");
        renderBinding(button, action);
      }, renderBinding),
    ),
    createHudSettingsSection(settingsStore).element,
  );
  const refresh = (): void => refreshers.forEach((fn) => fn());
  onBindingsChange(refresh);

  resetButton.addEventListener("click", () => {
    endCapture();
    resetBindings();
    showMessage("Controls reset to defaults.");
  });

  panel.append(header, message, groups, resetButton);
  element.append(panel);

  function open(): void {
    element.hidden = false;
    closeButton.focus();
  }

  function close(): void {
    endCapture();
    element.hidden = true;
  }

  // Capture phase on window, ahead of the input controller and the Escape handler below, so the
  // key chosen for a binding neither moves the player nor fires its old action.
  window.addEventListener(
    "keydown",
    (event) => {
      if (!capturing) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;

      const { action } = capturing;
      if (event.key === "Escape") {
        endCapture();
        showMessage("");
        return;
      }

      const result = setBinding(action, event.key);
      if (result.ok) {
        endCapture();
        showMessage(`${ACTION_NAMES[action]} is now ${keyLabel(action)}.`);
      } else {
        showMessage(bindingMessage(event.key, result));
      }
    },
    true,
  );

  element.addEventListener("click", (event) => {
    if (event.target === element) close();
  });
  closeButton.addEventListener("click", close);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !element.hidden) close();
  });

  return { element, open, close };
}

function renderGroup(
  group: ControlGroup,
  refreshers: (() => void)[],
  startCapture: (action: BindableAction, button: HTMLButtonElement) => void,
  renderBinding: (button: HTMLButtonElement, action: BindableAction) => void,
): HTMLElement {
  const section = document.createElement("section");
  section.className = "controls-menu__group";

  const heading = document.createElement("h3");
  heading.textContent = group.title;

  const list = document.createElement("dl");
  list.className = "controls-menu__list";

  for (const control of group.controls) {
    const input = document.createElement("dt");
    const { rebind } = control;
    if (rebind) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "controls-menu__key";
      button.addEventListener("click", () => startCapture(rebind, button));
      refreshers.push(() => renderBinding(button, rebind));
      renderBinding(button, rebind);
      input.append(button);
    } else {
      input.textContent = control.input();
      refreshers.push(() => {
        input.textContent = control.input();
      });
    }

    const action = document.createElement("dd");
    action.textContent = control.action;

    list.append(input, action);
  }

  section.append(heading, list);
  return section;
}
