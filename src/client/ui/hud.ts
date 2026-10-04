import type { VoiceStatus } from "../audio/proximityAudio.js";
import { selfOf, type SessionView } from "../network/sessionState.js";
import {
  actionableError,
  connectionLabel,
  controlsView,
  newServerAction,
  noticesView,
  placeStatusLabel,
  positionLabel,
  roomCodeLabel,
  vitalsView,
} from "../state/hudView.js";
import type { Vector2 } from "../../shared/types/core.js";
import { createActions } from "./hud/actions.js";
import { createLine, createStat } from "./hud/dom.js";
import { createInventory } from "./hud/inventory.js";
import { createRoster } from "./hud/roster.js";
import { createSession } from "./hud/session.js";
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

/** Composes the HUD from the modules under `hud/`; what each element shows lives in `state/hudView.ts`. */
export function createHud(options: HudOptions) {
  const element = document.createElement("header");
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

  // What the hub is waiting for, and what the last run cost. Neither is an error and neither is a
  // refused action, so each gets its own line rather than fighting over the action status. Decay is
  // a timer running out, not a failed action.
  const gateNotice = createLine("hud__notice");
  const torchWarning = createLine("hud__warning");
  const decayWarning = createLine("hud__warning");
  const outcomeBanner = createLine("hud__outcome");
  const errorBox = createLine("hud__error");

  const leftGroup = document.createElement("div");
  leftGroup.className = "hud__group";
  leftGroup.append(
    title,
    session.connectionElement,
    session.roomElement,
    placeStatus.element,
    session.positionElement,
    actionStatus.element,
    vitals.element,
    gateNotice.element,
    torchWarning.element,
    decayWarning.element,
    outcomeBanner.element,
    errorBox.element,
  );

  const rightGroup = document.createElement("div");
  rightGroup.className = "hud__group";
  rightGroup.append(
    roster.element,
    ...inventory.elements,
    ...actions.elements,
    ...session.buttons,
    ...session.voiceElements,
  );

  element.append(leftGroup, rightGroup);

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
      const notices = noticesView(view, self);

      session.setConnection(connectionLabel(view));
      session.setRoom(roomCodeLabel(view));
      session.update(controls, self ? self.ready : null);
      placeStatus.value.textContent = placeStatusLabel(view, self);
      errorBox.set(actionableError(view));
      vitals.update(vitalsView(self));

      gateNotice.set(notices.gate);
      torchWarning.set(notices.torch);
      decayWarning.set(notices.decay);
      outcomeBanner.set(notices.outcome);

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
