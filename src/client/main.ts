import { MOVE_INTERVAL_MS } from "../shared/game/movement.js";
import type { Vector2 } from "../shared/types/core.js";
import { requestMicrophonePreview } from "./audio/proximityAudio.js";
import { createInputController } from "./input/inputController.js";
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
  type SessionView,
} from "./network/sessionState.js";
import { createCanvasRenderer } from "./rendering/canvasRenderer.js";
import { createPlaceholderDungeon, predictMove, reconcile } from "./state/gameState.js";
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
  others: othersOf(view),
}));

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

app.append(hud.element, lobby.element, renderer.canvas);

const input = createInputController();

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
    renderedDungeon = {
      tiles: view.dungeon.map.tiles,
      monsters: view.dungeon.monsters
        .filter((monster) => monster.alive)
        .map((monster) => monster.position),
    };
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
