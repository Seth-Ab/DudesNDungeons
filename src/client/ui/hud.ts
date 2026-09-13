import { PLAYER_MAX_HEALTH } from "../../shared/constants/game.js";
import type { VoiceStatus } from "../audio/proximityAudio.js";
import { selfOf, type SessionView } from "../network/sessionState.js";

interface HudOptions {
  onEnableVoice: () => void;
  onToggleReady: (ready: boolean) => void;
  onLeave: () => void;
  onOpenMenu: () => void;
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

/** At or below this share of health, bars turn orange. */
const LOW_HEALTH_RATIO = 0.35;

/** A clicked button keeps focus, and Space would then press it again instead of attacking. */
function createButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", () => {
    button.blur();
    onClick();
  });
  return button;
}

export function createHud(options: HudOptions) {
  const element = document.createElement("header");
  element.className = "hud";

  const title = document.createElement("h1");
  title.className = "hud__title";
  title.textContent = "DudesNDungeons";

  const connectionStatus = createStat("Connection", "offline");
  const roomStatus = createStat("Room", "-");
  const voiceStatus = createStat("Voice", "voice disabled");

  const health = document.createElement("div");
  health.className = "hud__health";
  health.hidden = true;
  const healthBar = document.createElement("div");
  healthBar.className = "hud__bar";
  const healthFill = document.createElement("div");
  healthFill.className = "hud__bar-fill";
  healthBar.append(healthFill);
  const healthText = document.createElement("span");
  health.append("HP", healthBar, healthText);

  const inventory = document.createElement("ul");
  inventory.className = "hud__inventory";
  inventory.hidden = true;

  const errorBox = document.createElement("p");
  errorBox.className = "hud__error";
  errorBox.hidden = true;

  const roster = document.createElement("ul");
  roster.className = "hud__roster";

  let ready = false;
  const readyButton = createButton("Ready", () => {
    ready = !ready;
    options.onToggleReady(ready);
  });
  const menuButton = createButton("Menu", options.onOpenMenu);
  const leaveButton = createButton("Leave", options.onLeave);
  const voiceButton = createButton("Enable Voice", options.onEnableVoice);

  const leftGroup = document.createElement("div");
  leftGroup.className = "hud__group";
  leftGroup.append(title, connectionStatus.element, roomStatus.element, health, inventory, errorBox);

  const rightGroup = document.createElement("div");
  rightGroup.className = "hud__group";
  rightGroup.append(
    roster,
    readyButton,
    menuButton,
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
      menuButton.disabled = !inSession;
      leaveButton.disabled = !inSession;

      const self = selfOf(view);
      if (self && self.ready !== ready) {
        ready = self.ready;
      }
      readyButton.textContent = ready ? "Ready ✓" : "Ready";

      health.hidden = !self;
      inventory.hidden = !self;
      if (self) {
        const ratio = self.health / PLAYER_MAX_HEALTH;
        healthFill.style.width = `${Math.round(ratio * 100)}%`;
        healthFill.classList.toggle("hud__bar-fill--low", ratio <= LOW_HEALTH_RATIO);
        healthText.textContent = self.health > 0 ? `${self.health}/${PLAYER_MAX_HEALTH}` : "down";

        inventory.replaceChildren(
          ...(self.inventory.length === 0
            ? [inventoryNote("Pack empty")]
            : self.inventory.map((item, index) => {
                const entry = document.createElement("li");
                entry.className = "hud__inventory-item";
                const slot = document.createElement("kbd");
                slot.textContent = String(index + 1);
                entry.append(slot, item.name);
                return entry;
              })),
        );
      }

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

function inventoryNote(text: string): HTMLLIElement {
  const note = document.createElement("li");
  note.className = "hud__inventory-empty";
  note.textContent = text;
  return note;
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
