import { PLAYER_RESPAWN_MS } from "../shared/constants/game.js";
import { MOVE_INTERVAL_MS, normalizeDirection } from "../shared/game/movement.js";
import type { Vector2 } from "../shared/types/core.js";
import { requestMicrophonePreview } from "./audio/proximityAudio.js";
import { createInputController, type GameAction } from "./input/inputController.js";
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
  applyEvent,
  noEffects,
  pruneEffects,
  withNotice,
  type Body,
  type Effects,
} from "./state/effects.js";
import {
  PLACEHOLDER_TILES,
  nearestInteraction,
  planUse,
  predictMove,
  reconcile,
  type Interaction,
} from "./state/gameState.js";
import { createHud } from "./ui/hud.js";
import { createLobby } from "./ui/lobby.js";
import { createOverlay, type Banner } from "./ui/overlay.js";
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

/** Locally predicted position. Only drawn once the server has placed this player. */
let localPosition: Vector2 = { x: 0, y: 0 };
/** The direction the player last moved, which is where their swing goes. */
let aim: Vector2 = { x: 0, y: 1 };
let lastIntentAt = Number.NEGATIVE_INFINITY;
/** When this client saw its player go down, for the respawn countdown. */
let downedAt: number | null = null;
let view: SessionView = initialSessionView;
let effects: Effects = noEffects;
let interaction: Interaction | null = null;
let menuOpen = false;
let frameNow = performance.now();

const client = createSessionClient({
  httpUrl: endpoints.httpUrl,
  wsUrl: endpoints.wsUrl,
  tokenStore: tokenStore(),
});

const renderer = createCanvasRenderer(() => ({
  tiles: view.dungeon?.map.tiles ?? PLACEHOLDER_TILES,
  dungeon: view.dungeon,
  localPosition,
  self: selfOf(view),
  others: othersOf(view),
  effects,
  interaction,
  now: frameNow,
}));

function setMenuOpen(open: boolean): void {
  menuOpen = open;
  overlay.setMenuOpen(open);
}

function leaveDungeon(): void {
  client.leave();
  setMenuOpen(false);
  lobby.setMessage("You left the dungeon.");
  lobby.focus();
}

const hud = createHud({
  onEnableVoice: async () => {
    hud.setVoiceStatus("requesting microphone");
    hud.setVoiceStatus(await requestMicrophonePreview());
  },
  onToggleReady: (ready) => client.setReady(ready),
  onLeave: leaveDungeon,
  onOpenMenu: () => setMenuOpen(true),
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

const overlay = createOverlay({
  onResume: () => setMenuOpen(false),
  onLeave: leaveDungeon,
});

app.append(hud.element, lobby.element, renderer.canvas, overlay.element);

function notify(text: string): void {
  effects = withNotice(effects, text, performance.now());
}

/** The player and dungeon when this client may act: joined, standing, and not in the menu. */
function actingSelf() {
  const self = selfOf(view);
  if (view.phase !== "inSession" || !view.dungeon || !self || self.health <= 0 || menuOpen) {
    return null;
  }
  return { self, dungeon: view.dungeon };
}

function handleAction(action: GameAction): void {
  if (action.type === "toggleMenu") {
    if (view.phase === "inSession") setMenuOpen(!menuOpen);
    return;
  }

  const acting = actingSelf();
  if (!acting) return;
  const { self, dungeon } = acting;

  switch (action.type) {
    case "attack":
      client.sendAttack(aim);
      return;

    case "interact": {
      const target = nearestInteraction(dungeon, self, localPosition);
      if (!target) {
        notify("Nothing to use here.");
        return;
      }
      if (target.refusal) {
        notify(target.refusal);
        return;
      }
      if (target.action === "pickup") client.pickUp(target.targetId);
      else client.interact(target.targetId);
      return;
    }

    case "drinkTonic":
    case "useSlot": {
      const item =
        action.type === "drinkTonic"
          ? self.inventory.find((candidate) => candidate.kind === "tonic")
          : self.inventory[action.slot];
      const plan = planUse(self, item, action.type === "drinkTonic" ? "No tonic to drink." : undefined);
      if ("refusal" in plan) {
        notify(plan.refusal);
        return;
      }
      client.useItem(plan.itemId);
      return;
    }
  }
}

const input = createInputController({ onAction: handleAction });

// Paced to the server's move interval, so the client sends intents at the rate the server accepts
// them and predicts exactly the steps the server will take.
setInterval(() => {
  const heading = input.heading();
  const acting = actingSelf();
  if (!heading || !acting) return;

  // Intent only. The server owns placement; snapshots correct the prediction.
  if (!client.sendMoveIntent(heading)) return;

  lastIntentAt = performance.now();
  aim = normalizeDirection(heading) ?? aim;
  localPosition = predictMove(acting.dungeon, othersOf(view), localPosition, heading);
}, MOVE_INTERVAL_MS);

function bodyOf(id: string): Body | null {
  if (id === view.selfId) return { position: localPosition, facing: aim };

  const player = view.players.find((candidate) => candidate.id === id);
  if (player) return { position: player.position, facing: player.facing };

  const monster = view.dungeon?.monsters.find((candidate) => candidate.id === id);
  return monster ? { position: monster.position, facing: null } : null;
}

client.onMessage((message) => {
  effects = applyEvent(effects, message, { selfId: view.selfId, bodyOf }, performance.now());
});

client.subscribe((next) => {
  const joinedNow = view.phase !== "inSession" && next.phase === "inSession";
  view = next;

  const self = selfOf(view);
  if (self) {
    // A fresh join or resume adopts the server's position outright; after that, the prediction is
    // kept until it settles or drifts.
    localPosition = joinedNow
      ? { ...self.position }
      : reconcile(localPosition, self.position, performance.now() - lastIntentAt);
    if (joinedNow) aim = { ...self.facing };

    if (self.health > 0) downedAt = null;
    else downedAt ??= performance.now();
  } else {
    downedAt = null;
  }

  if (view.phase !== "inSession" && menuOpen) setMenuOpen(false);

  hud.syncTo(view);
  lobby.syncTo(view);
});

function bannerFor(now: number): Banner | null {
  if (view.phase !== "inSession") return null;

  if (view.dungeon?.cleared) {
    return {
      title: "Vault cleared!",
      detail: "Your party made it out of the Ember Vault.",
      action: { label: "Back to the lobby", run: leaveDungeon },
    };
  }

  if (downedAt !== null) {
    // The server does not send its respawn time, so count from when this client saw the fall.
    const seconds = Math.ceil((downedAt + PLAYER_RESPAWN_MS - now) / 1000);
    return {
      title: "You're down",
      detail: seconds > 0 ? `Back on your feet in about ${seconds}s.` : "Getting back up...",
    };
  }

  return null;
}

function frame(now: number): void {
  frameNow = now;
  effects = pruneEffects(effects, now);

  const acting = actingSelf();
  interaction = acting ? nearestInteraction(acting.dungeon, acting.self, localPosition) : null;

  renderer.render();
  overlay.setNotice(effects.notice?.text ?? null);
  overlay.setBanner(bannerFor(now));

  requestAnimationFrame(frame);
}

input.start();
lobby.focus();
requestAnimationFrame(frame);
