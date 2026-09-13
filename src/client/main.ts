import { requestMicrophonePreview } from "./audio/proximityAudio";
import { createInputController } from "./input/inputController";
import { createGameClient } from "./network/gameClient";
import { createCanvasRenderer } from "./rendering/canvasRenderer";
import { createInitialGameState, moveLocalPlayer } from "./state/gameState";
import { createHud } from "./ui/hud";
import "./styles.css";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("App root element not found.");
}

const gameState = createInitialGameState();
const gameClient = createGameClient({
  url: import.meta.env.VITE_WS_URL ?? "ws://localhost:8787",
});
const renderer = createCanvasRenderer(gameState);
const hud = createHud({
  onEnableVoice: async () => {
    const status = await requestMicrophonePreview();
    hud.setVoiceStatus(status);
  },
});

app.append(hud.element, renderer.canvas);

const input = createInputController({
  onMove: (direction) => {
    moveLocalPlayer(gameState, direction);
    renderer.render();
    gameClient.sendMoveIntent(direction);
    hud.setPosition(gameState.localPlayer.position);
  },
});

gameClient.onStatusChange((status) => {
  hud.setConnectionStatus(status);
});

gameClient.connect();
input.start();
renderer.render();
hud.setPosition(gameState.localPlayer.position);
