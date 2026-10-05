import { MOVE_INTERVAL_MS } from "../shared/game/movement.js";
import type { EntityId, Vector2 } from "../shared/types/core.js";
import { requestMicrophonePreview } from "./audio/proximityAudio.js";
import { createInputController, type GameplayAction } from "./input/inputController.js";
import {
  createLocalStorageProfileSecretStore,
  createMemoryProfileSecretStore,
  createMemoryTokenStore,
  createSessionStorageTokenStore,
  resolveEndpoints,
} from "./network/endpoints.js";
import {
  createLocalStorageHudSettingsStore,
  createMemoryHudSettingsStore,
} from "./state/hudSettings.js";
import { createSessionClient } from "./network/sessionClient.js";
import {
  initialSessionView,
  othersOf,
  selfOf,
  visibleOthersOf,
  type SessionView,
} from "./network/sessionState.js";
import { createCanvasRenderer } from "./rendering/canvasRenderer.js";
import { createPlaceholderDungeon, predictMove, reconcile } from "./state/gameState.js";
import {
  emptyRemoteInterpolation,
  remoteInterpolatedPosition,
  resetRemoteInterpolation,
  updateRemoteInterpolation,
  type RemoteInterpolationState,
} from "./state/remoteInterpolation.js";
import { createPopupField, damagePopup, newAttacks } from "./state/combatFeedback.js";
import { nearestDownedAlly, nearestInteraction, nearestLoot } from "./state/reach.js";
import {
  entranceMessage,
  entranceStatus,
  gatePrompt,
  SEALED_EXIT_MESSAGE,
} from "./state/runFlow.js";
import { createControlsMenu } from "./ui/controlsMenu.js";
import { createHud } from "./ui/hud.js";
import { createLobby } from "./ui/lobby.js";
import "./styles.css";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("App root element not found.");
}

const endpoints = resolveEndpoints(import.meta.env.VITE_WS_URL);

function tokenStore() {
  try {
    return createSessionStorageTokenStore(window.sessionStorage);
  } catch {
    // Storage can be blocked outright; the client still plays, it just cannot reclaim a slot.
    return createMemoryTokenStore();
  }
}

function profileSecretStore() {
  try {
    return createLocalStorageProfileSecretStore(window.localStorage);
  } catch {
    // Same fallback, one step worse: progression then lasts only as long as the page.
    return createMemoryProfileSecretStore();
  }
}

function hudSettingsStore() {
  const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  try {
    return createLocalStorageHudSettingsStore(window.localStorage, prefersReducedMotion);
  } catch {
    return createMemoryHudSettingsStore(prefersReducedMotion);
  }
}

let renderedDungeon = createPlaceholderDungeon();
/** Locally predicted position. Only drawn once the server has placed this player. */
let localPosition: Vector2 = { x: 0, y: 0 };
let lastIntentAt = Number.NEGATIVE_INFINITY;
let view: SessionView = initialSessionView;
/** Buffered remote positions, drawn slightly in the past. Local prediction never touches this. */
let remoteInterpolation: RemoteInterpolationState = emptyRemoteInterpolation;
/** Floating damage numbers, and the last attack sequence already turned into one. */
const popupField = createPopupField();
let lastAttackSeq = 0;

const client = createSessionClient({
  httpUrl: endpoints.httpUrl,
  wsUrl: endpoints.wsUrl,
  tokenStore: tokenStore(),
  profileSecretStore: profileSecretStore(),
});

const renderer = createCanvasRenderer(() => {
  const now = performance.now();
  return {
    dungeon: renderedDungeon,
    localPosition,
    self: selfOf(view),
    others: visibleOthersOf(view).map((player) => ({
      ...player,
      position: remoteInterpolatedPosition(remoteInterpolation, player.id, now, player.position),
    })),
    location: view.location,
    gatePrompt: view.location === "hub" ? gatePrompt(view.players) : null,
    popups: popupField.active(now),
  };
});

const controlsMenu = createControlsMenu(hudSettingsStore());

const hud = createHud({
  onEnableVoice: async () => {
    hud.setVoiceStatus("requesting microphone");
    hud.setVoiceStatus(await requestMicrophonePreview());
  },
  onToggleReady: (ready) => client.setReady(ready),
  onLeave: () => {
    client.leave();
    lobby.setMessage("You left the dungeon.");
    lobby.focus();
  },
  onAttack: () => performAction("attack"),
  onAction: (action) => performAction(action),
  onUseSlot: (slot) => useInventorySlot(slot),
  onOpenControls: () => controlsMenu.open(),
});

const lobby = createLobby({
  onCreateRoom: async (playerName) => {
    try {
      const roomCode = await client.createRoom();
      lobby.setRoomCode(roomCode);
      client.join(roomCode, playerName);
    } catch (error) {
      lobby.setMessage(error instanceof Error ? error.message : "Could not create a dungeon.");
    }
  },
  onJoinRoom: (roomCode, playerName) => client.join(roomCode, playerName),
});

app.append(hud.element, lobby.element, controlsMenu.element, renderer.canvas);
renderer.resize();

const input = createInputController({ onAction: performAction });

// Paced to the server's move interval, so the client sends intents at the rate the server accepts
// them and predicts exactly the steps the server will take.
setInterval(() => {
  const heading = input.heading();
  const self = selfOf(view);
  // A downed player cannot move; the server would refuse it, so do not predict it either.
  if (!heading || view.phase !== "inSession" || !view.dungeon || !self || self.health <= 0) return;

  // Intent only. The server owns placement; snapshots correct the prediction.
  if (!client.sendMoveIntent(heading)) return;

  lastIntentAt = performance.now();
  localPosition = predictMove(view.dungeon, othersOf(view), localPosition, heading);
  hud.setPosition(localPosition);
}, MOVE_INTERVAL_MS);

client.subscribe((next) => {
  const joinedNow = view.phase !== "inSession" && next.phase === "inSession";
  // The party moves between the hub and a run as one; a location change relocates everyone, so any
  // slide in progress would cut across the whole map instead of tracking a step.
  const transitioned =
    view.location !== null && next.location !== null && view.location !== next.location;
  // Only a fresh snapshot carries new positions; a ready toggle or an attack must not count as one,
  // or it would read as confirmation that a moving player has stopped.
  const snapshotArrived = next.tick !== view.tick;
  view = next;

  if (view.dungeon) {
    renderedDungeon = view.dungeon;
  }

  const now = performance.now();
  if (joinedNow || transitioned) {
    remoteInterpolation = resetRemoteInterpolation(visibleOthersOf(view), now);
  } else if (snapshotArrived) {
    remoteInterpolation = updateRemoteInterpolation(remoteInterpolation, visibleOthersOf(view), now);
  }

  const self = selfOf(view);
  if (self) {
    // A fresh join or resume adopts the server's position outright; after that, the prediction is
    // kept until it settles or drifts.
    localPosition = joinedNow
      ? { ...self.position }
      : reconcile(localPosition, self.position, performance.now() - lastIntentAt);
    hud.setPosition(localPosition);
  }

  showDamageNumbers();

  hud.syncTo(view);
  lobby.syncTo(view);
});

/**
 * Turns attacks the view has not shown yet into floating numbers. The server sends every attack in
 * the session to every member, so only those whose target this client can place are drawn.
 */
function showDamageNumbers(): void {
  // A fresh view (leaving a session) restarts the sequence.
  if (view.attackSeq < lastAttackSeq) lastAttackSeq = 0;

  const now = performance.now();
  for (const attack of newAttacks(view, lastAttackSeq)) {
    const popup = damagePopup(view, attack, localPosition);
    if (popup) popupField.add(popup, now);
  }
  lastAttackSeq = view.attackSeq;
}

input.start();
lobby.focus();

// The one place a frame is drawn. Snapshots and predicted moves only update state; drawing them as
// they arrived as well put two or three full redraws into each display frame, and that main-thread
// load starved the movement timer, so a player slowed down the longer they played.
function renderLoop(): void {
  renderer.render();
  requestAnimationFrame(renderLoop);
}
requestAnimationFrame(renderLoop);

function performAction(action: GameplayAction): void {
  const self = selfOf(view);
  if (view.phase !== "inSession" || !view.dungeon || !self || self.health <= 0) return;

  switch (action) {
    case "attack": {
      const direction = input.heading() ?? self.facing;
      if (!client.sendAttack(direction)) hud.setActionStatus("No connection");
      return;
    }
    case "pickup": {
      const itemId = nearestLootId();
      if (!itemId) {
        hud.setActionStatus("No loot nearby");
        return;
      }
      client.pickupItem(itemId);
      return;
    }
    case "interact": {
      const targetId = nearestInteractionTargetId();
      if (!targetId) {
        hud.setActionStatus("Nothing nearby");
        return;
      }

      // The gate is the one refusal worth answering before the round trip. The server replies to a
      // party that is not ready with a bare `notPermitted`, which is also its answer to a locked
      // door and to a tonic at full health, so the client would have nothing to say beyond "no".
      // Same bargain as `predictMove`: mirror the rule the server owns, and let the server still
      // decide. The check is by target, not by location, so a dungeon exit is never held back.
      if (view.location === "hub" && isExit(targetId)) {
        const status = entranceStatus(view.players);
        if (status.kind === "waiting") {
          hud.setActionStatus(entranceMessage(status));
          return;
        }
      }

      // The other refusal worth a sentence: a living boss seals the way out. Same mirror, same
      // rule that the server still decides.
      if (view.location === "dungeon" && isSealedExit(targetId)) {
        hud.setActionStatus(SEALED_EXIT_MESSAGE);
        return;
      }

      client.interact(targetId);
      return;
    }
    case "carry": {
      if (self.carryingPlayerId) {
        client.dropCarry();
        return;
      }

      const targetId = nearestDownedPlayerId();
      if (!targetId) {
        hud.setActionStatus("No one down nearby");
        return;
      }

      client.liftPlayer(targetId);
      return;
    }
    case "useSlot1":
      useInventorySlot(0);
      return;
    case "useSlot2":
      useInventorySlot(1);
      return;
    case "useSlot3":
      useInventorySlot(2);
      return;
  }
}

function useInventorySlot(slot: number): void {
  const self = selfOf(view);
  const item = self?.inventory[slot];
  if (!item) {
    hud.setActionStatus("Empty slot");
    return;
  }
  client.useItem(item.id);
}

function isExit(targetId: EntityId): boolean {
  return view.dungeon?.exits.some((exit) => exit.id === targetId) ?? false;
}

function isSealedExit(targetId: EntityId): boolean {
  return view.dungeon?.exits.some((exit) => exit.id === targetId && exit.sealed) ?? false;
}

function nearestDownedPlayerId(): EntityId | null {
  return nearestDownedAlly(view, localPosition)?.id ?? null;
}

function nearestLootId(): EntityId | null {
  return nearestLoot(view, localPosition)?.id ?? null;
}

function nearestInteractionTargetId(): EntityId | null {
  return nearestInteraction(view, localPosition)?.id ?? null;
}
