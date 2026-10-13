import type { VoiceState } from "../audio/voiceMesh.js";
import { isTypingTarget } from "../input/inputController.js";
import { DEBUG_KEY, type GameplayAction } from "../input/keyBindings.js";
import { selfOf, type SessionView } from "../network/sessionState.js";
import {
  connectionLabel,
  actionPrompt,
  controlsView,
  hubStatusView,
  runClockView,
  heldView,
  hotbarView,
  newServerAction,
  placeStatusLabel,
  positionLabel,
  roomCodeLabel,
  toastMessages,
  vitalsView,
} from "../state/hudView.js";
import type { Vector2 } from "../../shared/types/core.js";
import { createActions } from "./hud/actions.js";
import { createDamageVignette } from "./hud/damageVignette.js";
import { createHubStatus } from "./hud/hubStatus.js";
import { createRunClock } from "./hud/runClock.js";
import { createPanel, createStat } from "./hud/dom.js";
import { createHotbar } from "./hud/hotbar.js";
import { createInventory } from "./hud/inventory.js";
import { createMinimap } from "./hud/minimap.js";
import { createPartyFrames } from "./hud/partyFrames.js";
import { createSession } from "./hud/session.js";
import { createToasts } from "./hud/toasts.js";
import { createVitals } from "./hud/vitals.js";
import { createVoice } from "./hud/voice.js";

interface HudOptions {
  onToggleVoice: () => void;
  onToggleMute: () => void;
  onToggleDeafen: () => void;
  onToggleReady: (ready: boolean) => void;
  onLeave: () => void;
  onAttack: () => void;
  onAction: (action: GameplayAction) => void;
  onUseSlot: (slot: number) => void;
  onOpenControls: () => void;
}

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
  const voice = createVoice(options);
  const placeStatus = createStat("Place", "-");
  const actionStatus = createStat("Action", "-");
  const vitals = createVitals();
  const partyFrames = createPartyFrames();
  const inventory = createInventory();
  const minimap = createMinimap();
  const actions = createActions(options);
  const runClock = createRunClock();
  const hubStatus = createHubStatus();
  const vignette = createDamageVignette();
  const hotbar = createHotbar(options);
  // Everything that used to be its own message line: the hub gate, the run outcome, the torch and
  // decay warnings, and the error box.
  const toasts = createToasts();

  const statusPanel = createPanel("hud__panel hud__panel--status");
  statusPanel.append(title, placeStatus.element, actionStatus.element);

  const sessionPanel = createPanel("hud__panel hud__panel--session");
  const sessionButtons = document.createElement("div");
  sessionButtons.className = "hud__buttons";
  sessionButtons.append(...session.buttons, inventory.toggle);
  const voiceButtons = document.createElement("div");
  voiceButtons.className = "hud__buttons";
  voiceButtons.append(...voice.buttons);
  sessionPanel.append(
    session.roomElement,
    session.connectionElement,
    voice.statusElement,
    voice.meterElement,
    session.positionElement,
    sessionButtons,
    voiceButtons,
    minimap.element,
  );

  const partyPanel = createPanel("hud__panel hud__panel--party");
  partyPanel.append(vitals.element);

  const actionPanel = createPanel("hud__panel hud__panel--actions");
  const actionButtons = document.createElement("div");
  actionButtons.className = "hud__buttons";
  actionButtons.append(...actions.elements);
  actionPanel.append(runClock.element, actionButtons);

  element.append(
    vignette.element,
    statusPanel,
    partyFrames.element,
    toasts.element,
    hubStatus.element,
    sessionPanel,
    partyPanel,
    actionPanel,
    hotbar.element,
    inventory.panel,
  );

  // The prompt follows the predicted position, which moves between snapshots.
  let currentView: SessionView | null = null;
  let currentPosition: Vector2 = { x: 0, y: 0 };
  const refreshPrompt = (): void => {
    hotbar.updatePrompt(
      currentView ? actionPrompt(currentView, selfOf(currentView), currentPosition) : null,
    );
  };

  const setDebug = (on: boolean): void => {
    sessionPanel.classList.toggle("hud__panel--debug", on);
    session.positionElement.hidden = !on;
  };
  setDebug(new URLSearchParams(window.location.search).has("debug"));

  // `?debug` in the URL starts with the readouts on.
  window.addEventListener("keydown", (event) => {
    if (event.key !== DEBUG_KEY || event.repeat || isTypingTarget(event.target)) return;
    setDebug(session.positionElement.hidden);
  });

  return {
    element,

    setVoiceState(state: VoiceState) {
      voice.setState(state);
    },

    setVoiceLevel(level: number) {
      voice.setLevel(level);
    },

    setPosition(position: Vector2) {
      session.setPosition(positionLabel(position));
      currentPosition = position;
      minimap.setPosition(position);
      refreshPrompt();
    },

    toggleMinimap() {
      minimap.toggle();
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
      voice.setInSession(!controls.sessionControlsDisabled);
      placeStatus.value.textContent = placeStatusLabel(view, self);
      vitals.update(vitalsView(self, view.run), self ? self.health : null, view.staminaRefusals);

      vignette.update(self ? self.health : null);
      runClock.update(runClockView(view));
      hubStatus.update(hubStatusView(view));
      toasts.update(toastMessages(view, self));

      actions.update(controls);

      const serverAction = newServerAction(view, lastServerAction);
      if (serverAction) {
        lastServerAction = serverAction;
        actionStatus.value.textContent = serverAction;
      }

      currentView = view;
      hotbar.updateSlots(hotbarView(view, self));
      hotbar.updateHeld(heldView(view, self));
      hotbar.updateTorch(self);
      refreshPrompt();

      inventory.update(self);
      partyFrames.update(view);
      minimap.update(view);
    },
  };
}
