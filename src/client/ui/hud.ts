import type { VoiceStatus } from "../audio/proximityAudio.js";
import { selfOf, type SessionView } from "../network/sessionState.js";
import {
  PLAYER_MAX_HEALTH,
  PLAYER_MAX_RESISTANCE,
  PLAYER_MAX_STAMINA,
  RESISTANCE_DECAY_WARNING_MS,
} from "../../shared/constants/game.js";
import type { InventoryItem, RunState, Vector2 } from "../../shared/types/core.js";

interface HudOptions {
  onEnableVoice: () => void;
  onToggleReady: (ready: boolean) => void;
  onLeave: () => void;
  onAttack: () => void;
  onPickup: () => void;
  onInteract: () => void;
  onUseSlot: (slot: number) => void;
}

const PHASE_LABELS: Record<SessionView["phase"], string> = {
  offline: "offline",
  connecting: "connecting",
  connected: "connected",
  joining: "joining",
  inSession: "in dungeon",
  reconnecting: "reconnecting",
  failed: "connection lost",
};

export function createHud(options: HudOptions) {
  const element = document.createElement("header");
  element.className = "hud";

  const title = document.createElement("h1");
  title.className = "hud__title";
  title.textContent = "DudesNDungeons";

  const connectionStatus = createStat("Connection", "offline");
  const roomStatus = createStat("Room", "-");
  const positionStatus = createStat("Position", "-");
  const voiceStatus = createStat("Voice", "voice disabled");
  const actionStatus = createStat("Action", "-");

  const healthBar = createBar("Health", "health");
  const resistanceBar = createBar("Resistance", "resistance");
  const staminaBar = createBar("Stamina", "stamina");

  const vitals = document.createElement("div");
  vitals.className = "hud__vitals";
  vitals.append(healthBar.element, resistanceBar.element, staminaBar.element);

  // Its own line, not folded into the error box: decay is a timer running out, not a failed action.
  const decayWarning = document.createElement("p");
  decayWarning.className = "hud__warning";
  decayWarning.hidden = true;

  const errorBox = document.createElement("p");
  errorBox.className = "hud__error";
  errorBox.hidden = true;

  const roster = document.createElement("ul");
  roster.className = "hud__roster";

  const readyButton = document.createElement("button");
  readyButton.type = "button";
  readyButton.textContent = "Ready";
  let ready = false;
  readyButton.addEventListener("click", () => {
    ready = !ready;
    options.onToggleReady(ready);
  });

  const leaveButton = document.createElement("button");
  leaveButton.type = "button";
  leaveButton.textContent = "Leave";
  leaveButton.addEventListener("click", options.onLeave);

  const voiceButton = document.createElement("button");
  voiceButton.type = "button";
  voiceButton.textContent = "Enable Voice";
  voiceButton.addEventListener("click", options.onEnableVoice);

  const attackButton = createActionButton("Attack", options.onAttack);
  const pickupButton = createActionButton("Pickup", options.onPickup);
  const interactButton = createActionButton("Interact", options.onInteract);
  const useButtons = [0, 1, 2].map((slot) =>
    createActionButton(`Use ${slot + 1}`, () => options.onUseSlot(slot)),
  );

  const inventory = document.createElement("ol");
  inventory.className = "hud__inventory";

  const leftGroup = document.createElement("div");
  leftGroup.className = "hud__group";
  leftGroup.append(
    title,
    connectionStatus.element,
    roomStatus.element,
    positionStatus.element,
    actionStatus.element,
    vitals,
    decayWarning,
    errorBox,
  );

  const rightGroup = document.createElement("div");
  rightGroup.className = "hud__group";
  rightGroup.append(
    roster,
    inventory,
    attackButton,
    pickupButton,
    interactButton,
    ...useButtons,
    readyButton,
    leaveButton,
    voiceStatus.element,
    voiceButton,
  );

  element.append(leftGroup, rightGroup);

  return {
    element,

    setVoiceStatus(status: VoiceStatus) {
      voiceStatus.value.textContent = status;
    },

    setPosition(position: Vector2) {
      positionStatus.value.textContent = `${position.x.toFixed(2)}, ${position.y.toFixed(2)}`;
    },

    setActionStatus(status: string) {
      actionStatus.value.textContent = status;
    },

    syncTo(view: SessionView) {
      connectionStatus.value.textContent = PHASE_LABELS[view.phase];
      roomStatus.value.textContent = view.roomCode ?? "-";

      // `notImplemented` is the expected answer for actions the backend has not built yet, so it
      // is not something to alarm a player with.
      const actionable =
        view.lastError && view.lastError.code !== "notImplemented" ? view.lastError.message : "";
      errorBox.textContent = actionable;
      errorBox.hidden = actionable === "";

      const inSession = view.phase === "inSession";
      readyButton.disabled = !inSession;
      leaveButton.disabled = !inSession;

      const self = selfOf(view);
      healthBar.set(self?.health ?? 0, PLAYER_MAX_HEALTH);
      resistanceBar.set(self?.resistance ?? 0, PLAYER_MAX_RESISTANCE);
      staminaBar.set(self?.stamina ?? 0, PLAYER_MAX_STAMINA);

      const warning = inSession ? decayMessage(view.run) : "";
      decayWarning.textContent = warning;
      decayWarning.hidden = warning === "";

      const canAct = inSession && (self?.health ?? 0) > 0;
      attackButton.disabled = !canAct;
      pickupButton.disabled = !canAct;
      interactButton.disabled = !canAct;
      if (self && self.ready !== ready) {
        ready = self.ready;
      }
      readyButton.textContent = ready ? "Ready ✓" : "Ready";
      if (view.lastAction) actionStatus.value.textContent = view.lastAction;

      renderInventory(inventory, self?.inventory ?? []);
      useButtons.forEach((button, slot) => {
        button.disabled = !canAct || !self?.inventory[slot];
      });

      roster.replaceChildren(
        ...view.players.map((player) => {
          const item = document.createElement("li");
          item.className = "hud__roster-entry";
          if (!player.connected) item.classList.add("hud__roster-entry--offline");
          if (player.id === view.selfId) item.classList.add("hud__roster-entry--self");

          const standing = player.health > 0 ? (player.ready ? "ready" : "waiting") : "down";
          const state = player.connected ? standing : "disconnected";
          item.textContent = `${player.name} · ${player.health}hp · ${state}`;
          return item;
        }),
      );
    },
  };
}

/**
 * What to say about resistance decay. Silent until the server says decay is close, so the warning
 * means something when it does appear.
 */
function decayMessage(run: RunState | null): string {
  if (!run) return "";
  if (run.decaying) return "Resistance is falling. Get out of the dungeon.";
  if (run.decayStartsInMs > RESISTANCE_DECAY_WARNING_MS) return "";

  return `Resistance starts falling in ${Math.ceil(run.decayStartsInMs / 1000)}s.`;
}

/** A labelled fill bar. The server owns the numbers; this only draws them. */
function createBar(label: string, modifier: string) {
  const element = document.createElement("div");
  element.className = "hud__bar";

  const name = document.createElement("span");
  name.className = "hud__bar-label";
  name.textContent = label;

  const track = document.createElement("div");
  track.className = "hud__bar-track";

  const fill = document.createElement("div");
  fill.className = `hud__bar-fill hud__bar-fill--${modifier}`;
  track.append(fill);

  const value = document.createElement("span");
  value.className = "hud__bar-value";

  element.append(name, track, value);

  return {
    element,
    set(current: number, max: number) {
      const ratio = max > 0 ? Math.max(0, Math.min(1, current / max)) : 0;
      fill.style.width = `${ratio * 100}%`;
      value.textContent = `${Math.round(current)}`;
    },
  };
}

function createActionButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function renderInventory(list: HTMLOListElement, items: readonly InventoryItem[]): void {
  list.replaceChildren(
    ...[0, 1, 2].map((slot) => {
      const item = document.createElement("li");
      item.className = "hud__inventory-slot";
      item.textContent = items[slot]?.name ?? "-";
      return item;
    }),
  );
}

function createStat(label: string, initialValue: string) {
  const element = document.createElement("div");
  element.className = "hud__stat";

  const value = document.createElement("span");
  value.textContent = initialValue;
  element.textContent = `${label}: `;
  element.append(value);

  return { element, value };
}
