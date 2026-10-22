import type { EmoteKind } from "../../shared/constants/emotes.js";
import { PROTOCOL_VERSION } from "../../shared/constants/game.js";
import {
  parseServerMessage,
  serializeClientMessage,
  type ClientMessage,
  type VoiceSignal,
} from "../../shared/protocol/index.js";
import type { CosmeticSlot, PlayerAppearance, PlayerId, Vector2 } from "../../shared/types/core.js";
import {
  applyServerMessage,
  initialSessionView,
  type SessionView,
} from "./sessionState.js";
import { rejectionMessage, wardrobeRejectionMessage } from "../state/runFlow.js";

/** The slice of `WebSocket` this client uses, so tests can supply a double. */
export interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: "open" | "close" | "error", handler: () => void): void;
  addEventListener(type: "message", handler: (event: { data: unknown }) => void): void;
}

/**
 * Where the resume token lives. Injected because `sessionStorage` does not exist in the node test
 * environment, and because the token is a credential worth keeping behind one small interface.
 */
export interface TokenStore {
  read(roomCode: string): string | null;
  write(roomCode: string, token: string): void;
  clear(roomCode: string): void;
}

/**
 * Where the profile secret lives. Not room-scoped, unlike `TokenStore`: one device has one profile,
 * and it plays in whichever room it likes.
 *
 * There is no `clear`. Leaving a dungeon ends a session; it does not disown everything the player
 * has banked, and nothing in the flow should be able to throw progression away by accident.
 */
export interface ProfileSecretStore {
  read(): string | null;
  write(secret: string): void;
}

export type SavedRunChoice = "continue" | "discard";

export interface SessionClientOptions {
  /** Origin for REST calls, e.g. `http://localhost:8080`. */
  httpUrl: string;
  /** Origin for the socket, e.g. `ws://localhost:8080`. */
  wsUrl: string;
  tokenStore: TokenStore;
  profileSecretStore: ProfileSecretStore;
  createSocket?: (url: string) => SocketLike;
  fetchFn?: typeof fetch;
  /** Backoff schedule for reconnects, in ms. Must stay inside the server's 60s grace window. */
  retryDelaysMs?: number[];
  scheduleRetry?: (callback: () => void, delayMs: number) => void;
}

const DEFAULT_RETRY_DELAYS_MS = [500, 1000, 2000, 4000, 8000, 15000];

const OPEN = 1;

export function createSessionClient(options: SessionClientOptions) {
  const {
    httpUrl,
    wsUrl,
    tokenStore,
    profileSecretStore,
    createSocket = (url) => new WebSocket(url) as unknown as SocketLike,
    fetchFn = fetch,
    retryDelaysMs = DEFAULT_RETRY_DELAYS_MS,
    scheduleRetry = (callback, delayMs) => {
      setTimeout(callback, delayMs);
    },
  } = options;

  let view: SessionView = initialSessionView;
  let socket: SocketLike | null = null;
  let listeners: ((view: SessionView) => void)[] = [];
  let signalListeners: ((fromPlayerId: PlayerId, signal: VoiceSignal) => void)[] = [];
  let moveSequence = 0;
  let attackSequence = 0;
  let drawSequence = 0;
  /** The last item `useItem` was sent for, so a maxed refusal can name the scroll to offer converting. */
  let lastUsedItemId: string | null = null;
  /** Set when a purchase is sent and cleared by its outcome, so a refusal can be shown in the shop panel. */
  let buyPending = false;
  /**
   * The wardrobe request awaiting its outcome, so a refusal shows in the wardrobe rather than the
   * action line. A purchase is settled by `progressionUpdated`, an equip by a snapshot wearing it.
   */
  let wardrobePending: { kind: "buy" } | { kind: "equip"; slot: CosmeticSlot; id: string | null } | null = null;
  let retryIndex = 0;
  /**
   * What to rejoin with after an unexpected drop. Null once the player leaves deliberately.
   * `savedRun` answers a saved-run prompt and is dropped once joined, so a later reconnect resumes
   * the slot instead of repeating, or discarding, the choice.
   */
  let pending: { roomCode: string; playerName: string; savedRun: SavedRunChoice | null } | null = null;

  function update(next: SessionView): void {
    view = next;
    for (const listener of listeners) listener(view);
  }

  function setPhase(phase: SessionView["phase"]): void {
    if (view.phase !== phase) update({ ...view, phase });
  }

  function send(message: ClientMessage): boolean {
    if (!socket || socket.readyState !== OPEN) return false;
    socket.send(serializeClientMessage(message));
    return true;
  }

  function sendJoin(roomCode: string, playerName: string, savedRun: SavedRunChoice | null): void {
    const resumeToken = tokenStore.read(roomCode);
    const profileSecret = profileSecretStore.read();
    send({
      type: "joinSession",
      protocolVersion: PROTOCOL_VERSION,
      roomCode,
      playerName,
      ...(resumeToken === null ? {} : { resumeToken }),
      // Omitted rather than sent as null when this device has no profile yet, so the server reads
      // it as "issue me one" rather than having to treat an empty credential as absent.
      ...(profileSecret === null ? {} : { profileSecret }),
      ...(savedRun === null ? {} : { savedRun }),
    });
  }

  function handleMessage(raw: unknown): void {
    if (typeof raw !== "string") return;

    const parsed = parseServerMessage(raw);
    if (!parsed.ok) {
      // A frame the client cannot understand is a version or server bug, not a player error.
      update({
        ...view,
        lastError: { code: "invalidMessage", message: parsed.error },
      });
      return;
    }

    if (parsed.message.type === "sessionJoined" && pending) {
      tokenStore.write(parsed.message.roomCode, parsed.message.resumeToken);
      // Non-null only when the server minted a profile for this device. It will never repeat it,
      // so this write is the only chance to keep it.
      if (parsed.message.profileSecret !== null) {
        profileSecretStore.write(parsed.message.profileSecret);
      }
      retryIndex = 0;
      pending.savedRun = null;
    }

    if (parsed.message.type === "savedAndQuit") {
      // The server took this player out of the room and keeps their place in the save, so the token
      // names nothing and there is nothing to reconnect to.
      tokenStore.clear(parsed.message.roomCode);
      pending = null;
      socket?.close();
      socket = null;
      update(applyServerMessage(view, parsed.message));
      return;
    }

    if (parsed.message.type === "voiceSignalRelay") {
      const { fromPlayerId, signal } = parsed.message;
      for (const listener of signalListeners) listener(fromPlayerId, signal);
      return;
    }

    const next = applyServerMessage(view, parsed.message);
    const maxedRefusal = parsed.message.type === "actionRejected" && parsed.message.reason === "skillMaxed";
    if (buyPending && parsed.message.type === "actionRejected") {
      // A purchase refusal is shown in the shop panel; a maxed scroll is not a conversion offer here.
      buyPending = false;
      update({ ...next, shopNotice: rejectionMessage(parsed.message.reason) });
      return;
    }
    if (buyPending && parsed.message.type === "progressionUpdated") buyPending = false;
    if (wardrobePending && parsed.message.type === "actionRejected" && parsed.message.sequence === null) {
      wardrobePending = null;
      update({ ...next, wardrobeNotice: wardrobeRejectionMessage(parsed.message.reason) });
      return;
    }
    if (wardrobePending?.kind === "buy" && parsed.message.type === "progressionUpdated") wardrobePending = null;
    if (wardrobePending?.kind === "equip" && parsed.message.type === "stateSnapshot") {
      const { slot, id } = wardrobePending;
      const self = next.players.find((player) => player.id === next.selfId);
      if (self?.cosmetics[slot] === id) wardrobePending = null;
    }
    update(maxedRefusal && lastUsedItemId !== null ? { ...next, convertPromptItemId: lastUsedItemId } : next);
  }

  function openSocket(): void {
    if (socket && socket.readyState === OPEN) return;

    setPhase(view.phase === "offline" ? "connecting" : view.phase);
    const next = createSocket(wsUrl);
    socket = next;

    next.addEventListener("open", () => {
      retryIndex = 0;
      setPhase("connected");
      if (pending) {
        setPhase("joining");
        sendJoin(pending.roomCode, pending.playerName, pending.savedRun);
      }
    });

    next.addEventListener("message", (event) => handleMessage(event.data));

    next.addEventListener("close", () => {
      socket = null;
      // No pending session means the player left on purpose, so staying closed is correct.
      if (!pending) {
        setPhase("offline");
        return;
      }
      scheduleReconnect();
    });

    next.addEventListener("error", () => {
      // `close` always follows, and it owns the retry, so this only records the cause.
    });
  }

  function scheduleReconnect(): void {
    const delay = retryDelaysMs[retryIndex];
    if (delay === undefined) {
      // Past the grace window the slot is gone, so a retry would silently become a new player.
      update({
        ...view,
        phase: "failed",
        lastError: {
          code: "internalError",
          message: "Lost connection to the dungeon and the reconnect window has closed",
        },
      });
      return;
    }

    retryIndex += 1;
    setPhase("reconnecting");
    scheduleRetry(() => {
      if (pending) openSocket();
    }, delay);
  }

  return {
    get view(): SessionView {
      return view;
    },

    subscribe(listener: (view: SessionView) => void): () => void {
      listeners.push(listener);
      listener(view);
      return () => {
        listeners = listeners.filter((candidate) => candidate !== listener);
      };
    },

    /** Relayed WebRTC handshakes from party members, for the voice mesh. */
    onVoiceSignal(listener: (fromPlayerId: PlayerId, signal: VoiceSignal) => void): () => void {
      signalListeners.push(listener);
      return () => {
        signalListeners = signalListeners.filter((candidate) => candidate !== listener);
      };
    },

    /** Creates a dungeon and returns its room code, without joining it. */
    async createRoom(): Promise<string> {
      const response = await fetchFn(`${httpUrl}/sessions`, { method: "POST" });
      if (!response.ok) {
        throw new Error(`Could not create a dungeon (HTTP ${response.status})`);
      }
      const body = (await response.json()) as { roomCode: string };
      return body.roomCode;
    },

    join(roomCode: string, playerName: string, savedRun: SavedRunChoice | null = null): void {
      pending = { roomCode, playerName, savedRun };
      retryIndex = 0;
      update({ ...view, lastError: null });

      if (socket && socket.readyState === OPEN) {
        setPhase("joining");
        sendJoin(roomCode, playerName, savedRun);
        return;
      }
      openSocket();
    },

    leave(): void {
      const roomCode = view.roomCode;
      send({ type: "leaveSession" });
      if (roomCode !== null) tokenStore.clear(roomCode);

      pending = null;
      socket?.close();
      socket = null;
      update({ ...initialSessionView, phase: "offline" });
    },

    /**
     * Leaves the run keeping its carry and position in the room save. Success arrives as
     * `savedAndQuit`; a refusal (`inCombat`, `notPermitted`) as `saveAndQuitRefused`, shown as
     * `saveQuitNotice`.
     */
    saveAndQuit(): boolean {
      if (view.saveQuitNotice !== null) update({ ...view, saveQuitNotice: null });
      return send({ type: "saveAndQuit" });
    },

    setReady(ready: boolean): boolean {
      return send({ type: "setReady", ready });
    },

    /** Sent once per slot, after a `sessionJoined` that said `needsAppearance`. */
    setAppearance(appearance: PlayerAppearance): boolean {
      return send({ type: "setAppearance", appearance });
    },

    /**
     * Intent, never a position. The sequence lets a later server correction say which input it is
     * answering. The server paces moves to `MOVE_INTERVAL_MS`, so callers should send at that rate.
     */
    sendMoveIntent(direction: Vector2): boolean {
      moveSequence += 1;
      return send({ type: "playerMoveIntent", sequence: moveSequence, direction });
    },

    sendAttack(direction: Vector2): boolean {
      attackSequence += 1;
      return send({
        type: "playerAttack",
        sequence: attackSequence,
        direction,
        targetId: null,
      });
    },

    /** Starts drawing the held bow. The server times the draw; no strength is ever sent. */
    sendBeginDraw(direction: Vector2): boolean {
      drawSequence += 1;
      return send({ type: "beginDraw", sequence: drawSequence, direction });
    },

    sendReleaseDraw(direction: Vector2): boolean {
      drawSequence += 1;
      return send({ type: "releaseDraw", sequence: drawSequence, direction });
    },

    pickupItem(itemId: string): boolean {
      return send({ type: "pickupItem", itemId });
    },

    interact(targetId: string): boolean {
      return send({ type: "playerInteract", targetId });
    },

    /** `targetPlayerId` names the downed ally for an item used on someone else, such as salts. */
    useItem(itemId: string, targetPlayerId?: string): boolean {
      lastUsedItemId = itemId;
      return send(targetPlayerId ? { type: "useItem", itemId, targetPlayerId } : { type: "useItem", itemId });
    },

    /** Converts a maxed scroll to coin. Called only from the prompt's Confirm; the server re-checks. */
    convertSkillScroll(itemId: string): boolean {
      if (view.convertPromptItemId !== null) update({ ...view, convertPromptItemId: null });
      return send({ type: "convertSkillScroll", itemId });
    },

    /** Buys a scroll from the hub skill shop by stock entry. The server names the price and may refuse. */
    buySkillScroll(itemId: string): boolean {
      buyPending = true;
      if (view.shopNotice !== null) update({ ...view, shopNotice: null });
      return send({ type: "buySkillScroll", itemId });
    },

    /** Buys a cosmetic at the wardrobe stall by id. The server names the price and may refuse. */
    buyCosmetic(id: string): boolean {
      wardrobePending = { kind: "buy" };
      if (view.wardrobeNotice !== null) update({ ...view, wardrobeNotice: null });
      return send({ type: "buyCosmetic", id });
    },

    /** Wears an owned cosmetic, or takes a slot off with null. Only the hub allows it. */
    equipCosmetic(slot: CosmeticSlot, id: string | null): boolean {
      wardrobePending = { kind: "equip", slot, id };
      if (view.wardrobeNotice !== null) update({ ...view, wardrobeNotice: null });
      return send({ type: "equipCosmetic", slot, id });
    },

    /** Opens the conversion prompt from the Skills panel. Sends nothing; the prompt's Confirm does. */
    requestConvertPrompt(itemId: string): void {
      update({ ...view, convertPromptItemId: itemId });
    },

    /** Closes the conversion prompt without sending anything. */
    dismissConvertPrompt(): void {
      if (view.convertPromptItemId !== null) update({ ...view, convertPromptItemId: null });
    },

    dropItem(itemId: string): boolean {
      return send({ type: "dropItem", itemId });
    },

    giveItem(itemId: string, targetPlayerId: string): boolean {
      return send({ type: "giveItem", itemId, targetPlayerId });
    },

    /** Swaps the hand item with an inventory item, or stows it into a free slot when null. */
    swapHeld(itemId: string | null): boolean {
      return send({ type: "swapHeld", itemId });
    },

    /** Takes an item out of the party vault. The server checks the hub, the vault area, and room. */
    withdrawVaultItem(itemId: string): boolean {
      return send({ type: "withdrawVaultItem", itemId });
    },

    /** Stores a carried item in the party vault, under the same checks. */
    depositVaultItem(itemId: string): boolean {
      return send({ type: "depositVaultItem", itemId });
    },

    liftPlayer(targetPlayerId: string): boolean {
      return send({ type: "liftPlayer", targetPlayerId });
    },

    dropCarry(): boolean {
      return send({ type: "dropCarry" });
    },

    emote(kind: EmoteKind): boolean {
      return send({ type: "emote", kind });
    },

    sendVoiceSignal(targetPlayerId: PlayerId, signal: VoiceSignal): boolean {
      return send({ type: "voiceSignal", targetPlayerId, signal });
    },

    disconnect(): void {
      pending = null;
      socket?.close();
      socket = null;
      update({ ...view, phase: "offline" });
    },
  };
}

export type SessionClient = ReturnType<typeof createSessionClient>;
