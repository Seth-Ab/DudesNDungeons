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
import {
  LOCAL_SPAWN,
  MOVE_VECTORS,
  createPlaceholderDungeon,
  predictMove,
} from "./state/gameState.js";
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

const dungeon = createPlaceholderDungeon();
let localPosition = { ...LOCAL_SPAWN };
let view: SessionView = initialSessionView;

const client = createSessionClient({
  httpUrl: endpoints.httpUrl,
  wsUrl: endpoints.wsUrl,
  tokenStore: tokenStore(),
});

const renderer = createCanvasRenderer(() => ({
  dungeon,
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
    localPosition = { ...LOCAL_SPAWN };
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

const input = createInputController({
  onMove: (direction) => {
    if (view.phase !== "inSession") return;

    localPosition = predictMove(dungeon, localPosition, direction);
    hud.setPosition(localPosition);
    // Intent only. The server owns placement and will correct this once Backend step 3 lands.
    client.sendMoveIntent(MOVE_VECTORS[direction]);
    renderer.render();
  },
});

client.subscribe((next) => {
  const joinedNow = view.phase !== "inSession" && next.phase === "inSession";
  view = next;

  if (joinedNow) {
    localPosition = { ...LOCAL_SPAWN };
    hud.setPosition(localPosition);
  }

  hud.syncTo(view);
  lobby.syncTo(view);
  renderer.render();
});

input.start();
lobby.focus();
