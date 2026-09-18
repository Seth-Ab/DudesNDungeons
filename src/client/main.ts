import { INTERACT_RANGE } from "../shared/constants/game.js";
import { distance, distanceToDoor, MOVE_INTERVAL_MS } from "../shared/game/movement.js";
import type { EntityId, Vector2 } from "../shared/types/core.js";
import { requestMicrophonePreview } from "./audio/proximityAudio.js";
import { createInputController, type GameplayAction } from "./input/inputController.js";
import {
  createMemoryTokenStore,
  createSessionStorageTokenStore,
  resolveEndpoints,
} from "./network/endpoints.js";
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

let renderedDungeon = createPlaceholderDungeon();
/** Locally predicted position. Only drawn once the server has placed this player. */
let localPosition: Vector2 = { x: 0, y: 0 };
let lastIntentAt = Number.NEGATIVE_INFINITY;
let view: SessionView = initialSessionView;

const client = createSessionClient({
  httpUrl: endpoints.httpUrl,
  wsUrl: endpoints.wsUrl,
  tokenStore: tokenStore(),
});

const renderer = createCanvasRenderer(() => ({
  dungeon: renderedDungeon,
  localPosition,
  self: selfOf(view),
  others: visibleOthersOf(view),
}));

const controlsMenu = createControlsMenu();

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
  onPickup: () => performAction("pickup"),
  onInteract: () => performAction("interact"),
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
  renderer.render();
}, MOVE_INTERVAL_MS);

client.subscribe((next) => {
  const joinedNow = view.phase !== "inSession" && next.phase === "inSession";
  view = next;

  if (view.dungeon) {
    renderedDungeon = view.dungeon;
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

  hud.syncTo(view);
  lobby.syncTo(view);
  renderer.render();
});

input.start();
lobby.focus();

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
      client.interact(targetId);
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

function nearestLootId(): EntityId | null {
  if (!view.dungeon) return null;

  return nearest(
    view.dungeon.loot
      .filter((loot) => !loot.pickedUp)
      .map((loot) => ({ id: loot.id, gap: distance(localPosition, loot.position) })),
  );
}

/**
 * A door is measured to the nearest point of its span, the way the server judges the reach it is
 * about to be sent. Measured to the centre, the client refused to send an interact for any door at
 * all: a doorway is a `TILE_SCALE` block, so its centre is two world units past the face a player
 * stands at and `INTERACT_RANGE` is a body's reach. No locked door could be opened from the UI.
 */
function nearestInteractionTargetId(): EntityId | null {
  if (!view.dungeon) return null;

  return nearest([
    ...view.dungeon.doors
      .filter((door) => !door.open)
      .map((door) => ({ id: door.id, gap: distanceToDoor(localPosition, door) })),
    ...view.dungeon.exits.map((exit) => ({
      id: exit.id,
      gap: distance(localPosition, exit.position),
    })),
  ]);
}

function nearest(targets: { id: EntityId; gap: number }[]): EntityId | null {
  const self = selfOf(view);
  if (!self) return null;

  const reachable = targets
    .filter((target) => target.gap <= INTERACT_RANGE)
    .sort((a, b) => a.gap - b.gap);

  return reachable[0]?.id ?? null;
}
