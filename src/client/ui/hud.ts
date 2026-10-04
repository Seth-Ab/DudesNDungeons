import type { VoiceStatus } from "../audio/proximityAudio.js";
import { isTypingTarget } from "../input/inputController.js";
import { selfOf, type SessionView } from "../network/sessionState.js";
import {
  connectionLabel,
  controlsView,
  newServerAction,
  placeStatusLabel,
  positionLabel,
  roomCodeLabel,
  toastMessages,
  vitalsView,
} from "../state/hudView.js";
import type { Vector2 } from "../../shared/types/core.js";
import { createActions } from "./hud/actions.js";
import { createPanel, createStat } from "./hud/dom.js";
import { createInventory } from "./hud/inventory.js";
import { createRoster } from "./hud/roster.js";
import { createSession } from "./hud/session.js";
import { createToasts } from "./hud/toasts.js";
import { createVitals } from "./hud/vitals.js";

interface HudOptions {
  onEnableVoice: () => void;
  onToggleReady: (ready: boolean) => void;
  onLeave: () => void;
  onAttack: () => void;
  onPickup: () => void;
  onInteract: () => void;
  onCarry: () => void;
  onUseSlot: (slot: number) => void;
  onOpenControls: () => void;
}

/** Backquote toggles the debug readouts; `?debug` in the URL starts with them on. */
const DEBUG_KEY = "`";

/**
 * Composes the HUD from the modules under `hud/`; what each element shows lives in
 * `state/hudView.ts`. The HUD is a set of overlay panels over the full-viewport canvas: the root
 * ignores the pointer, and only the panels' own buttons take it.
 */
export function createHud(options: HudOptions) {
  const element = document.createElement("div");
  element.className = "hud";

  /**
   * The last server action shown, so a client-side message is not wiped by the next snapshot 50ms
   * later. See `newServerAction`.
   */
  let lastServerAction: string | null = null;

  const title = document.createElement("h1");
  title.className = "hud__title";
  title.textContent = "DudesNDungeons";

  const session = createSession(options);
  const placeStatus = createStat("Place", "-");
  const actionStatus = createStat("Action", "-");
  const vitals = createVitals();
  const roster = createRoster();
  const inventory = createInventory();
  const actions = createActions(options);
  // Everything that used to be its own message line: the hub gate, the run outcome, the torch and
  // decay warnings, and the error box.
  const toasts = createToasts();

  const statusPanel = createPanel("hud__panel hud__panel--status");
  statusPanel.append(title, placeStatus.element, actionStatus.element, vitals.element);

  const sessionPanel = createPanel("hud__panel hud__panel--session");
  const sessionButtons = document.createElement("div");
  sessionButtons.className = "hud__buttons";
  sessionButtons.append(...session.buttons);
  sessionPanel.append(
    session.roomElement,
    session.connectionElement,
    session.voiceElement,
    session.positionElement,
    sessionButtons,
  );

  const partyPanel = createPanel("hud__panel hud__panel--party");
  partyPanel.append(roster.element, ...inventory.bankElements);

  const actionPanel = createPanel("hud__panel hud__panel--actions");
  const actionButtons = document.createElement("div");
  actionButtons.className = "hud__buttons";
  actionButtons.append(...actions.elements);
  actionPanel.append(inventory.slotsElement, inventory.torchElement, actionButtons);

  element.append(statusPanel, toasts.element, sessionPanel, partyPanel, actionPanel);

  const setDebug = (on: boolean): void => {
    sessionPanel.classList.toggle("hud__panel--debug", on);
    session.positionElement.hidden = !on;
  };
  setDebug(new URLSearchParams(window.location.search).has("debug"));

  window.addEventListener("keydown", (event) => {
    if (event.key !== DEBUG_KEY || event.repeat || isTypingTarget(event.target)) return;
    setDebug(session.positionElement.hidden);
  });

  return {
    element,

    setVoiceStatus(status: VoiceStatus) {
      session.setVoiceStatus(status);
    },

    setPosition(position: Vector2) {
      session.setPosition(positionLabel(position));
    },

    setActionStatus(status: string) {
      actionStatus.value.textContent = status;
    },

    syncTo(view: SessionView) {
      const self = selfOf(view);
      const controls = controlsView(view, self);

      session.setConnection(connectionLabel(view));
      session.setRoom(roomCodeLabel(view));
      session.update(controls, self ? self.ready : null);
      placeStatus.value.textContent = placeStatusLabel(view, self);
      vitals.update(vitalsView(self));

      toasts.update(toastMessages(view, self));

      actions.update(controls);

      const serverAction = newServerAction(view, lastServerAction);
      if (serverAction) {
        lastServerAction = serverAction;
        actionStatus.value.textContent = serverAction;
      }

      inventory.update(self);
      roster.update(view);
    },
  };
}
