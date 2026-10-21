import { MOVE_INTERVAL_MS } from "../shared/game/movement.js";
import type { EntityId, Vector2 } from "../shared/types/core.js";
import {
  captureMicrophone,
  createBrowserPeerLink,
  iceServersFrom,
} from "./audio/browserVoice.js";
import { createVoiceMesh } from "./audio/voiceMesh.js";
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
  inParty,
  selfOf,
  spawnedOthersOf,
  visibleOthersOf,
  type SessionView,
} from "./network/sessionState.js";
import { createCanvasRenderer } from "./rendering/canvasRenderer.js";
import {
  createPlaceholderDungeon,
  predictMove,
  reconcile,
  stepsIntoUndiscovered,
} from "./state/gameState.js";
import type { LitTileSet } from "./state/litTiles.js";
import {
  emptyRemoteInterpolation,
  remoteInterpolatedPosition,
  resetRemoteInterpolation,
  updateRemoteInterpolation,
  type RemoteInterpolationState,
} from "./state/remoteInterpolation.js";
import {
  createPopupField,
  createSwingField,
  damagePopup,
  newAttacks,
  swingArc,
} from "./state/combatFeedback.js";
import { bowAims } from "./state/bowIndicator.js";
import {
  nearestDownedAlly,
  nearestInteraction,
  nearestLoot,
  nearestRevivableAlly,
  nearestStandingAlly,
  usedOnDownedAlly,
} from "./state/reach.js";
import { actionableItem, noteSlotUsed, selectedItem } from "./state/selectedSlot.js";
import {
  entranceMessage,
  entranceStatus,
  gatePrompt,
  SEALED_EXIT_MESSAGE,
} from "./state/runFlow.js";
import { createEmoteField, newEmotes, placeEmotes } from "./state/emotes.js";
import { createDummyWobbles } from "./state/trainingDummies.js";
import {
  createLocalStorageLookStore,
  createMemoryLookStore,
} from "./state/characterDesign.js";
import { createCharacterDesign } from "./ui/characterDesign.js";
import { createControlsMenu } from "./ui/controlsMenu.js";
import { createEmoteWheel } from "./ui/emoteWheel.js";
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

function lookStore() {
  try {
    return createLocalStorageLookStore(window.localStorage);
  } catch {
    // The design screen still works; it just cannot remember the last look.
    return createMemoryLookStore();
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
/** The lit set that came with `renderedDungeon`. Null for the preview, which the server never lit. */
let renderedLit: LitTileSet | null = null;
/** Locally predicted position. Only drawn once the server has placed this player. */
let localPosition: Vector2 = { x: 0, y: 0 };
/** When the last predicted move was sent. Unpredicted moves leave the server in charge of placement. */
let lastPredictionAt = Number.NEGATIVE_INFINITY;
let view: SessionView = initialSessionView;
/** Buffered remote positions, drawn slightly in the past. Local prediction never touches this. */
let remoteInterpolation: RemoteInterpolationState = emptyRemoteInterpolation;
/** Floating damage numbers, and the last attack sequence already turned into one. */
const popupField = createPopupField();
const swingField = createSwingField();
/** Training dummies swaying from a hit, so everyone who sees the blow sees it land. */
const dummyWobbles = createDummyWobbles();
let lastAttackSeq = 0;
/** Emote bubbles over heads, and the last emote sequence already turned into one. */
const emoteField = createEmoteField();
let lastEmoteSeq = 0;

const client = createSessionClient({
  httpUrl: endpoints.httpUrl,
  wsUrl: endpoints.wsUrl,
  tokenStore: tokenStore(),
  profileSecretStore: profileSecretStore(),
});

/** The held movement keys' heading. Set once the input exists, which is after the first frame is asked for. */
let heldHeading: () => Vector2 | null = () => null;

const renderer = createCanvasRenderer(() => {
  const now = performance.now();
  const self = selfOf(view);
  const others = visibleOthersOf(view).map((player) => ({
    ...player,
    position: remoteInterpolatedPosition(remoteInterpolation, player.id, now, player.position),
  }));
  return {
    dungeon: renderedDungeon,
    lit: renderedLit,
    localPosition,
    self,
    others,
    location: view.location,
    gatePrompt: view.location === "hub" ? gatePrompt(view.players) : null,
    popups: popupField.active(now),
    swings: swingField.active(now),
    bowAims: bowAims(self, localPosition, heldHeading(), others),
    // Pinned to where each emoter is drawn, so a bubble rides the prediction and interpolation.
    emotes: placeEmotes(emoteField.active(now), (playerId) =>
      playerId === self?.id
        ? localPosition
        : (others.find((player) => player.id === playerId)?.position ?? null),
    ),
    dummyWobbles: dummyWobbles.angles(now),
  };
});

const controlsMenu = createControlsMenu(hudSettingsStore());

const emoteWheel = createEmoteWheel({
  onEmote: (kind) => {
    if (!client.emote(kind)) hud.setActionStatus("No connection");
  },
});

const iceServers = iceServersFrom(import.meta.env.VITE_ICE_SERVERS);

const voice = createVoiceMesh({
  capture: captureMicrophone,
  createPeerLink: (_peerId, local, events) => createBrowserPeerLink(local, events, iceServers),
  sendSignal: (targetId, signal) => client.sendVoiceSignal(targetId, signal),
  onChange: (state) => hud.setVoiceState(state),
});
client.onVoiceSignal((fromPlayerId, signal) => void voice.handleSignal(fromPlayerId, signal));

const hud = createHud({
  // The microphone is requested here and nowhere else: only a click on Enable Voice captures it.
  onToggleVoice: () => {
    const { status } = voice.state();
    if (status === "live" || status === "requesting") voice.disable();
    else void voice.enable();
  },
  onToggleMute: () => voice.setMuted(!voice.state().muted),
  onToggleDeafen: () => voice.setDeafened(!voice.state().deafened),
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
  onOpenEmotes: () => emoteWheel.open(),
  onWithdrawVaultItem: (itemId) => {
    if (!client.withdrawVaultItem(itemId)) hud.setActionStatus("No connection");
  },
  onDepositVaultItem: (itemId) => {
    if (!client.depositVaultItem(itemId)) hud.setActionStatus("No connection");
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

// Between the lobby and the hub, for a slot that has no character yet.
const design = createCharacterDesign({
  store: lookStore(),
  onConfirm: (look) => client.setAppearance(look),
  onBack: () => {
    client.leave();
    lobby.setMessage("You left the dungeon.");
    lobby.focus();
  },
});

app.append(hud.element, lobby.element, design.element, controlsMenu.element, emoteWheel.element, renderer.canvas);
renderer.resize();

const input = createInputController({ onAction: performAction, onRelease: releaseAction });
heldHeading = () => input.heading();

// Paced to the server's move interval, so the client sends intents at the rate the server accepts
// them and predicts exactly the steps the server will take.
setInterval(() => {
  const heading = input.heading();
  const self = selfOf(view);
  // A downed player cannot move; the server would refuse it, so do not predict it either.
  if (!heading || view.phase !== "inSession" || !view.dungeon || !self || self.health <= 0) return;
  // Still designing: the server refuses every intent, and the player has no place in the world yet.
  if (self.appearance === null) return;

  // Intent only. The server owns placement; snapshots correct the prediction.
  if (!client.sendMoveIntent(heading)) return;

  // A step off a seat stands the player up wherever the server finds room in front of it, which
  // the client cannot predict from inside the bench, so it follows the server's placement.
  if (self.seatId !== null) {
    lastPredictionAt = Number.NEGATIVE_INFINITY;
    return;
  }

  // Into the dark there is no map to predict against, so follow the server's placement instead.
  if (stepsIntoUndiscovered(view.dungeon, localPosition, heading)) {
    lastPredictionAt = Number.NEGATIVE_INFINITY;
    return;
  }

  lastPredictionAt = performance.now();
  localPosition = predictMove(view.dungeon, spawnedOthersOf(view), localPosition, heading);
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
  const rangeChanged = next.voiceRange !== view.voiceRange;
  // The server places a player the moment their look is accepted, far from wherever they were
  // before it, so that position is adopted outright rather than reconciled against a prediction.
  const spawnedNow = selfOf(view)?.appearance === null && selfOf(next)?.appearance != null;
  view = next;

  // Leaving, timing out, and a refused rejoin release the microphone and every peer link. A
  // reconnect keeps them: the audio does not run through the server.
  if (!inParty(view)) {
    voice.disable();
  } else if (view.phase === "inSession") {
    voice.syncParty(view.selfId, view.players);
  }
  if (rangeChanged) voice.applyRange(view.voiceRange);

  if (view.dungeon) {
    renderedDungeon = view.dungeon;
    renderedLit = view.lit;
  }

  const now = performance.now();
  if (joinedNow || transitioned) {
    remoteInterpolation = resetRemoteInterpolation(visibleOthersOf(view), now);
  } else if (snapshotArrived) {
    remoteInterpolation = updateRemoteInterpolation(remoteInterpolation, visibleOthersOf(view), now);
  }

  const self = selfOf(view);
  if (self) {
    // A fresh join, resume, or first spawn adopts the server's position outright; after that, the prediction is
    // kept until it settles or drifts.
    localPosition = joinedNow || spawnedNow
      ? { ...self.position }
      : reconcile(localPosition, self.position, performance.now() - lastPredictionAt);
    hud.setPosition(localPosition);
  }

  showDamageNumbers();
  showEmotes();
  emoteWheel.setSelf(selfOf(view));
  if (view.phase !== "inSession") emoteWheel.close();

  hud.syncTo(view);
  lobby.syncTo(view);
  design.syncTo(view);
});

/**
 * Turns attacks the view has not shown yet into floating numbers, swing arcs, and the sway of a
 * struck training dummy. The server sends every attack in the session to every member, so only
 * those whose target this client can place are drawn.
 */
function showDamageNumbers(): void {
  // A fresh view (leaving a session) restarts the sequence.
  if (view.attackSeq < lastAttackSeq) lastAttackSeq = 0;

  const now = performance.now();
  for (const attack of newAttacks(view, lastAttackSeq)) {
    const popup = damagePopup(view, attack, localPosition);
    if (popup) popupField.add(popup, now);
    const arc = swingArc(view, attack);
    if (arc) swingField.add(arc, now);
    const targetId = attack.targetId;
    const struckDummy =
      targetId !== null &&
      attack.damage > 0 &&
      view.dungeon?.dummies.some((dummy) => dummy.id === targetId);
    if (struckDummy) dummyWobbles.hit(targetId, now);
  }
  lastAttackSeq = view.attackSeq;
}

/** Puts a bubble over each emoter the view has heard from since the last call. */
function showEmotes(): void {
  // A fresh view (leaving a session) restarts the sequence.
  if (view.emoteSeq < lastEmoteSeq) {
    lastEmoteSeq = 0;
    emoteField.clear();
  }

  const now = performance.now();
  for (const emote of newEmotes(view.recentEmotes, lastEmoteSeq)) {
    emoteField.add(emote.playerId, emote.kind, now);
  }
  lastEmoteSeq = view.emoteSeq;
}

input.start();
lobby.focus();

// The one place a frame is drawn. Snapshots and predicted moves only update state; drawing them as
// they arrived as well put two or three full redraws into each display frame, and that main-thread
// load starved the movement timer, so a player slowed down the longer they played.
function renderLoop(): void {
  renderer.render();
  hud.setVoiceLevel(voice.inputLevel());
  hud.setSpeaking(voice.speakingPeers());
  requestAnimationFrame(renderLoop);
}
requestAnimationFrame(renderLoop);

/** The key of a hold action went up: for the bow, let the arrow go. */
function releaseAction(action: GameplayAction): void {
  if (action !== "drawBow") return;

  const self = selfOf(view);
  if (view.phase !== "inSession" || !self) return;
  client.sendReleaseDraw(input.heading() ?? self.facing);
}

function performAction(action: GameplayAction): void {
  // An overlay, not an act in the world: a downed player can still read the map.
  if (action === "toggleMinimap") {
    hud.toggleMinimap();
    return;
  }

  // Before the downed check below: a downed player can still call for help.
  if (action === "emoteWheel") {
    if (view.phase === "inSession") emoteWheel.toggle();
    return;
  }

  const self = selfOf(view);
  if (view.phase !== "inSession" || !view.dungeon || !self || self.health <= 0) return;
  if (self.appearance === null) return;

  switch (action) {
    case "attack": {
      const direction = input.heading() ?? self.facing;
      if (!client.sendAttack(direction)) hud.setActionStatus("No connection");
      return;
    }
    case "drawBow": {
      // The server decides whether there is a bow, an arrow, and the stamina; its refusal comes
      // back as an action status. All that is worth checking here is that a key is down at all.
      const direction = input.heading() ?? self.facing;
      if (!client.sendBeginDraw(direction)) hud.setActionStatus("No connection");
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
        // The vault is an area rather than an entity, and opening it is a panel rather than a
        // message: each take or store from the panel is what the server checks.
        if (!hud.openVault()) hud.setActionStatus("Nothing nearby");
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
    case "drop": {
      const item = actionableItem(self.inventory, self.held);
      if (!item) {
        hud.setActionStatus("Nothing to drop");
        return;
      }
      client.dropItem(item.id);
      return;
    }
    case "swapHeld": {
      const incoming = selectedItem(self.inventory);
      if (incoming) {
        client.swapHeld(incoming.id);
      } else if (self.held) {
        hud.setActionStatus("No free slot to stow it");
      } else {
        hud.setActionStatus("Nothing to swap");
      }
      return;
    }
    case "give": {
      const item = actionableItem(self.inventory, self.held);
      if (!item) {
        hud.setActionStatus("Nothing to give");
        return;
      }
      const ally = nearestStandingAlly(view, localPosition);
      if (!ally) {
        hud.setActionStatus("No one nearby");
        return;
      }
      client.giveItem(item.id, ally.id);
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

  // Smelling salts need someone to use them on. The server judges the target again.
  if (usedOnDownedAlly(item)) {
    const ally = nearestRevivableAlly(view, localPosition);
    if (!ally) {
      hud.setActionStatus("No one down nearby");
      return;
    }
    noteSlotUsed(slot);
    client.useItem(item.id, ally.id);
    return;
  }

  noteSlotUsed(slot);
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
