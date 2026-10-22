import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocketServer, type WebSocket } from "ws";
import {
  MAX_CLIENT_MESSAGE_BYTES,
  MAX_PARTY_SIZE,
  PROTOCOL_VERSION,
  RUN_AUTOSAVE_INTERVAL_MS,
  SERVER_TICK_MS,
  SERVER_TICK_RATE_HZ,
} from "../shared/constants/game.js";
import {
  parseClientMessage,
  serializeServerMessage,
  type ClientMessageType,
  type ErrorCode,
  type ServerMessage,
} from "../shared/protocol/index.js";
import type { PlayerId, PlayerState, ProfileId } from "../shared/types/core.js";
import { EMOTE_BURST, EMOTE_REFILL_PER_SECOND } from "../shared/constants/emotes.js";
import { dropCarry, liftPlayer } from "./game/carrying.js";
import { resolvePlayerAttack, simulate } from "./game/combat.js";
import { isSpawned, movePlayer } from "./game/dungeonState.js";
import { emoteAudience, emoteRefusal, playerEmotedFor } from "./game/emotes.js";
import { beginDraw, releaseDraw } from "./game/bow.js";
import {
  convertSkillScroll,
  depositVaultItem,
  dropItem,
  giveItem,
  interact,
  pickupItem,
  swapHeld,
  useItem,
  withdrawVaultItem,
} from "./game/items.js";
import { buySkillScroll, skillShopStockMessage } from "./game/shop.js";
import { buyCosmetic, equipCosmetic, wardrobeCatalogMessage } from "./game/wardrobe.js";
import { contentForSession, progressionCatalogFor, progressionUpdateFor } from "./game/progression.js";
import { resolvePuzzles } from "./game/puzzles.js";
import { resolveReadyPlates } from "./game/readyPlates.js";
import { resolveTraps } from "./game/traps.js";
import { partyWiped, returnToHub } from "./game/runLifecycle.js";
import { saveAndQuit } from "./game/saveAndQuit.js";
import { shareDiscoveredMaps } from "./game/mapSharing.js";
import { takeMapDiscovery, visibilityFrameForPlayer, voiceRangeForPlayer } from "./game/visibility.js";
import { runStateFor } from "./game/vitals.js";
import { toProfileState } from "./profiles/profile.js";
import { ProfileStore } from "./profiles/profileStore.js";
import { saveRoom, touchRoomSave } from "./saves/roomSaving.js";
import { SessionStore, partyRosterOf, rosterOf, toPlayerState, type Session, type SessionPlayer } from "./sessions/sessionStore.js";
import { resolveSignalTarget, SignalRateLimiter, signalRelayFor } from "./voice/signalRelay.js";

/**
 * What a player still designing their character may not do. They hold a slot but are not in the
 * world, so anything that acts on it, or readies them to leave it, waits for `setAppearance`.
 */
const REFUSED_WHILE_DESIGNING: ReadonlySet<ClientMessageType> = new Set<ClientMessageType>([
  "setReady",
  "playerMoveIntent",
  "playerAttack",
  "beginDraw",
  "releaseDraw",
  "playerInteract",
  "pickupItem",
  "useItem",
  "convertSkillScroll",
  "buySkillScroll",
  "buyCosmetic",
  "equipCosmetic",
  "dropItem",
  "giveItem",
  "swapHeld",
  "withdrawVaultItem",
  "depositVaultItem",
  "liftPlayer",
  "dropCarry",
  "emote",
  "saveAndQuit",
]);

const DEFAULT_SWEEP_INTERVAL_MS = 5_000;
/** A tick this slow is a tenth of the way to dropping the 20 Hz pace; see `slowTickMs`. */
const DEFAULT_SLOW_TICK_MS = 25;
/** At most one slow-tick line per this long, so a struggling server does not flood its own log. */
const SLOW_TICK_LOG_INTERVAL_MS = 5_000;

export interface GameServerOptions {
  store?: SessionStore;
  /**
   * Where roguelite profiles live. Defaults to an in-memory store, so a test or a bare
   * `createGameServer()` writes nothing; `src/server/index.ts` supplies the file-backed one.
   */
  profiles?: ProfileStore;
  tickIntervalMs?: number;
  sweepIntervalMs?: number;
  /** How often a room in the dungeon is saved. Defaults to `RUN_AUTOSAVE_INTERVAL_MS`. */
  autosaveIntervalMs?: number;
  /**
   * Wall clock in ms, which dates a room save so it can expire. Distinct from `now`: a save outlives
   * the process, and a monotonic reading means nothing after a restart. Defaults to `Date.now`.
   */
  wallNow?: () => number;
  /**
   * A tick that takes at least this long, in the clock of `now`, is logged. Defaults to half the
   * 50 ms tick budget, which leaves room to notice a trend before players feel it.
   */
  slowTickMs?: number;
  /**
   * Value for `Access-Control-Allow-Origin`. The client is served from a different origin in
   * development (Vite on 5173, this server on 8080), so without it the browser blocks room
   * creation. Defaults to any origin: the HTTP surface is anonymous and carries no credentials.
   */
  allowedOrigin?: string;
  /** Set false in tests to keep the reporter readable. */
  log?: boolean;
  /** Monotonic clock in ms, used to pace movement. Wall-clock time can jump backwards. */
  now?: () => number;
}

export interface GameServer {
  httpServer: Server;
  store: SessionStore;
  profiles: ProfileStore;
  listen(port: number, host: string): Promise<AddressInfo>;
  close(): Promise<void>;
}

/**
 * Wires sockets to the session rules. Everything transport-shaped lives here; everything about what
 * a dungeon *is* lives in `SessionStore`. Built as a factory so tests can boot a real server on an
 * ephemeral port with a fast clock instead of reaching for the compiled entry point.
 */
export function createGameServer(options: GameServerOptions = {}): GameServer {
  const store = options.store ?? new SessionStore();
  const profiles = options.profiles ?? new ProfileStore();
  const tickIntervalMs = options.tickIntervalMs ?? SERVER_TICK_MS;
  const sweepIntervalMs = options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
  const autosaveIntervalMs = options.autosaveIntervalMs ?? RUN_AUTOSAVE_INTERVAL_MS;
  const slowTickMs = options.slowTickMs ?? DEFAULT_SLOW_TICK_MS;
  const allowedOrigin = options.allowedOrigin ?? "*";
  const log = options.log ?? true;
  const now = options.now ?? (() => performance.now());
  const wallNow = options.wallNow ?? Date.now;

  const socketsByPlayer = new Map<PlayerId, WebSocket>();
  const signalLimiter = new SignalRateLimiter();
  const emoteLimiter = new SignalRateLimiter(EMOTE_BURST, EMOTE_REFILL_PER_SECOND);
  /** Parties whose downed state has been snapshotted but who are not yet returned to the hub. */
  const wipeAnnounced = new WeakSet<Session>();
  /**
   * The last `progressionUpdated` each connected player was sent, serialized. Progression changes in
   * several places (a scroll, an extraction, a wipe), so the tick compares rather than every call
   * site announcing, and a change cannot be forgotten by a path nobody thought of.
   */
  const lastProgressionSent = new Map<PlayerId, string>();
  /** The party roster each player last received, so it is resent only when it changes. */
  const lastRosterSent = new Map<PlayerId, string>();
  /** The vault revision each player last received, so the vault is resent only when it changes. */
  const lastVaultSent = new Map<PlayerId, number>();
  /** The run count whose shop stock each player last received, so it is resent only after a run ends. */
  const lastStockSent = new Map<PlayerId, number>();
  /** Dungeon parties whose save was written when they emptied, so the sweep does not write it again. */
  const savedWhenEmpty = new WeakSet<Session>();
  /** When a slow tick was last logged, or null before the first. */
  let lastSlowTickLoggedAt: number | null = null;

  const note = (message: string): void => {
    if (log) console.log(message);
  };

  function send(socket: WebSocket, message: ServerMessage): void {
    if (socket.readyState !== socket.OPEN) return;
    socket.send(serializeServerMessage(message));
  }

  function sendError(socket: WebSocket, code: ErrorCode, message: string): void {
    send(socket, { type: "sessionError", code, message });
  }


  /** Fans a message out to the party. `exceptPlayerId` skips the player who caused the change. */
  function broadcast(session: Session, message: ServerMessage, exceptPlayerId?: PlayerId): void {
    for (const player of session.players.values()) {
      if (player.id === exceptPlayerId) continue;

      const socket = socketsByPlayer.get(player.id);
      if (socket) send(socket, message);
    }
  }

  /**
   * One visibility pass per player per tick. The frame feeds both the snapshot and the voice
   * ranges, which are gated on the same rules; computing it twice was the tick's dominant cost.
   */
  /** Sends the owner their progression if it differs from what they last had. Owner-only. */
  function sendProgression(socket: WebSocket, session: Session, player: SessionPlayer): void {
    const update = progressionUpdateFor(player, contentForSession(session));
    const serialized = JSON.stringify(update);
    if (lastProgressionSent.get(player.id) === serialized) return;
    lastProgressionSent.set(player.id, serialized);
    send(socket, update);
  }

  /** Sends the party roster if it differs from what this player last had. Same for everyone, so it leaks nothing per viewer. */
  function sendPartyRoster(socket: WebSocket, playerId: PlayerId, serialized: string, message: ServerMessage): void {
    if (lastRosterSent.get(playerId) === serialized) return;
    lastRosterSent.set(playerId, serialized);
    send(socket, message);
  }

  /** Sends the party vault if it changed since this player last had it. The same list for everyone. */
  function sendPartyVault(socket: WebSocket, session: Session, playerId: PlayerId): void {
    if (lastVaultSent.get(playerId) === session.vault.revision) return;
    lastVaultSent.set(playerId, session.vault.revision);
    send(socket, { type: "partyVault", items: session.vault.items.map((item) => ({ ...item })) });
  }

  /**
   * Sends the skill shop's stock and the wardrobe catalogue if this room's run count moved since the
   * player last had them. Both rotate on the run count, and nothing else changes either.
   */
  function sendSkillShopStock(socket: WebSocket, session: Session, playerId: PlayerId): void {
    if (lastStockSent.get(playerId) === session.vault.runCount) return;
    lastStockSent.set(playerId, session.vault.runCount);
    send(socket, skillShopStockMessage(session));
    send(socket, wardrobeCatalogMessage(session));
  }

  /** Writes whatever an action changed: a profile, the vault, a room save. No-ops when nothing did. */
  function flushPersistent(): void {
    profiles.flush();
    store.vaults.flush();
    store.saves.flush();
  }

  /** Writes the room's save from its session. `forget` drops a leaver's run entry; see `saveRoom`. */
  function saveSessionRoom(session: Session, forget?: ProfileId): void {
    saveRoom(session, store.saves, now(), wallNow(), forget === undefined ? {} : { forget });
    store.saves.flush();
  }

  /** The party has emptied out of a run: nobody connected is left to autosave it, so write it now. */
  function saveEmptiedRun(session: Session): void {
    if (session.location !== "dungeon" || savedWhenEmpty.has(session)) return;
    if ([...session.players.values()].some((player) => player.connected)) return;
    savedWhenEmpty.add(session);
    saveSessionRoom(session);
  }

  function sendSnapshot(session: Session, playerId: PlayerId, roster: readonly PlayerState[]): void {
    const socket = socketsByPlayer.get(playerId);
    if (!socket) return;

    const player = session.players.get(playerId);
    if (!player) return;

    sendProgression(socket, session, player);
    const frame = visibilityFrameForPlayer(session, player, roster);
    send(socket, {
      type: "stateSnapshot",
      tick: session.tick,
      location: session.location,
      players: frame.players,
      dungeon: { ...frame.dungeon, map: takeMapDiscovery(session, player) },
      // The run clock belongs to the viewer, not the party: a player who joined late has been in
      // the dungeon for less time and their resistance reflects that.
      run: runStateFor(player, now()),
    });
    send(socket, voiceRangeForPlayer(session, player, frame));
  }

  function broadcastSnapshots(session: Session): void {
    // Built once for the whole party: every viewer filters the same public states.
    const roster = rosterOf(session);
    const partyRoster: ServerMessage = { type: "partyRoster", members: partyRosterOf(session) };
    const serializedRoster = JSON.stringify(partyRoster);
    for (const player of session.players.values()) {
      const socket = socketsByPlayer.get(player.id);
      if (socket) {
        sendPartyRoster(socket, player.id, serializedRoster, partyRoster);
        sendPartyVault(socket, session, player.id);
        sendSkillShopStock(socket, session, player.id);
      }
      sendSnapshot(session, player.id, roster);
    }
  }

  const httpServer = createServer((request, response) => {
    response.setHeader("access-control-allow-origin", allowedOrigin);

    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify({
          status: "ok",
          protocolVersion: PROTOCOL_VERSION,
          sessions: store.sessionCount,
        }),
      );
      return;
    }

    // Creating the dungeon over HTTP keeps the lobby flow ahead of the socket: a client gets a room
    // code to share, then everyone connects and joins with it.
    if (request.method === "POST" && request.url === "/sessions") {
      const session = store.createSession();
      note(`[session] created ${session.roomCode}`);
      response.writeHead(201, { "content-type": "application/json" });
      response.end(JSON.stringify({ sessionId: session.id, roomCode: session.roomCode }));
      return;
    }

    response.writeHead(404);
    response.end();
  });

  /**
   * Snapshots are mostly repetition - a generated map is 96x64 tiles and nearly all of them are
   * withheld as blanks until a player explores - so they deflate by roughly sixty to one. Without
   * this a four-player party costs about 600 kB/s of upstream, which no home server will carry.
   *
   * Context takeover is left on: the dictionary carries between frames, and consecutive snapshots
   * differ by very little. That costs memory per connection, which a party capped at four is well
   * within. Browsers negotiate this natively, so it needs nothing from the client.
   */
  const wss = new WebSocketServer({
    server: httpServer,
    // Sized to the largest message the protocol accepts; see `MAX_CLIENT_MESSAGE_BYTES`. `ws` closes
    // the socket with 1009 as soon as a frame exceeds it, so no "message" event (and no parse) runs.
    maxPayload: MAX_CLIENT_MESSAGE_BYTES,
    perMessageDeflate: {
      zlibDeflateOptions: { level: 6 },
      // Small frames cost more in framing overhead than they save.
      threshold: 512,
      concurrencyLimit: 10,
    },
  });

  wss.on("connection", (socket) => {
    // Identity for this socket, assigned on a successful join. Null until then, which is what
    // separates "has not joined" from "is in a dungeon".
    let playerId: PlayerId | null = null;

    socket.on("message", (data, isBinary) => {
      // The protocol is JSON text. Refused like malformed JSON, so the connection stays usable,
      // but without decoding the bytes as if they were text.
      if (isBinary) {
        note("[ws] rejected message: binary frame");
        sendError(socket, "invalidMessage", "Binary frames are not supported");
        return;
      }

      const result = parseClientMessage(data.toString());

      if (!result.ok) {
        note(`[ws] rejected message: ${result.error}`);
        // The character designer shows this code on its error line, so a bad look is named as one.
        sendError(
          socket,
          result.claimedType === "setAppearance" ? "invalidAppearance" : "invalidMessage",
          result.error,
        );
        return;
      }

      const message = result.message;

      if (message.type === "joinSession") {
        if (playerId !== null) {
          sendError(socket, "alreadyInSession", "This connection has already joined a dungeon");
          return;
        }

        if (message.protocolVersion !== PROTOCOL_VERSION) {
          sendError(
            socket,
            "protocolVersionMismatch",
            `Server speaks protocol v${PROTOCOL_VERSION}, client sent v${message.protocolVersion}`,
          );
          return;
        }

        // The secret names a profile or it does not; an unknown one is a fresh device rather than
        // an error, because there is nothing a player could do about a profile the server lost.
        const known = profiles.find(message.profileSecret);
        // Held so the secret can be sent back exactly when the server minted it, and never
        // otherwise: only a hash of it is kept, so a secret cannot be repeated on a later join.
        let issuedSecret: string | null = null;

        const joined = store.join({
          roomCode: message.roomCode,
          playerName: message.playerName,
          resumeToken: message.resumeToken,
          profile: known,
          // Called only once the join has otherwise succeeded, so a mistyped room code does not
          // strand an empty profile on disk.
          createProfile: () => {
            const created = profiles.create(message.playerName);
            issuedSecret = created.secret;
            return created.profile;
          },
        });

        if (!joined.ok) {
          sendError(socket, joined.code, joined.message);
          return;
        }

        const { session, player, resumed } = joined;
        playerId = player.id;
        socketsByPlayer.set(player.id, socket);
        savedWhenEmpty.delete(session);
        // Joining a room with a save counts as playing it, which keeps the save from expiring.
        touchRoomSave(store.saves, session.roomCode, wallNow());

        // Names the profile after whoever is playing it now, and dates it, so an operator reading
        // the file can tell a live profile from one abandoned months ago.
        if (issuedSecret === null) profiles.touch(player.profile, message.playerName);
        // A profile minted just now is worth writing immediately: everything else a session does is
        // recoverable, but a secret the client stores and the server forgets is a bank nobody owns.
        profiles.flush();

        // Carries the resume token and the profile secret, both credentials, so it goes to this
        // player alone and never through broadcast().
        send(socket, {
          type: "sessionJoined",
          sessionId: session.id,
          roomCode: session.roomCode,
          playerId: player.id,
          resumeToken: player.resumeToken,
          resumed,
          needsAppearance: !isSpawned(player),
          tickRate: SERVER_TICK_RATE_HZ,
          players: visibilityFrameForPlayer(session, player).players,
          profile: toProfileState(player.profile),
          profileSecret: issuedSecret,
        });

        // A new socket holds no geometry, so its first snapshot restarts the map from a baseline.
        player.mapSyncedTo = null;
        player.pendingDiscovery = [];

        // Owner-only, and sent fresh on every join: a new socket holds nothing yet.
        lastProgressionSent.delete(player.id);
        // Likewise the roster and the vault: the next tick sends them whether or not they changed.
        lastRosterSent.delete(player.id);
        lastVaultSent.delete(player.id);
        lastStockSent.delete(player.id);
        send(socket, progressionCatalogFor(contentForSession(session)));
        sendProgression(socket, session, player);

        broadcast(
          session,
          resumed
            ? { type: "playerConnectionChanged", playerId: player.id, connected: true }
            : { type: "playerJoined", player: toPlayerState(player, session) },
          player.id,
        );

        note(
          `[session] ${session.roomCode}: ${player.name} ${resumed ? "resumed" : "joined"} ` +
            `(${session.players.size}/${MAX_PARTY_SIZE})`,
        );
        return;
      }

      if (playerId === null) {
        sendError(socket, "notInSession", "Join a dungeon before sending this message");
        return;
      }

      if (message.type === "leaveSession") {
        const member = store.leave(playerId);
        socketsByPlayer.delete(playerId);
        lastProgressionSent.delete(playerId);
        lastRosterSent.delete(playerId);
        lastVaultSent.delete(playerId);
        lastStockSent.delete(playerId);
        signalLimiter.forget(playerId);
        emoteLimiter.forget(playerId);
        playerId = null;

        if (member) {
          broadcast(member.session, {
            type: "playerLeft",
            playerId: member.player.id,
            reason: "left",
          });
          note(`[session] ${member.session.roomCode}: ${member.player.name} left`);
          // Leaving abandons the run, so the save forgets this player's carry (their character stays).
          if (member.session.location === "dungeon") {
            saveSessionRoom(member.session, member.player.profile.id);
            saveEmptiedRun(member.session);
          }
        }
        return;
      }

      if (message.type === "saveAndQuit") {
        const quit = saveAndQuit(store, playerId, now(), wallNow());
        if (!quit.ok) {
          send(socket, { type: "actionRejected", sequence: null, reason: quit.reason });
          return;
        }

        store.saves.flush();
        const { member } = quit;
        socketsByPlayer.delete(playerId);
        lastProgressionSent.delete(playerId);
        lastRosterSent.delete(playerId);
        lastVaultSent.delete(playerId);
        lastStockSent.delete(playerId);
        signalLimiter.forget(playerId);
        emoteLimiter.forget(playerId);
        playerId = null;

        // Everyone else sees them leave the way they would for `leaveSession`.
        broadcast(member.session, { type: "playerLeft", playerId: member.player.id, reason: "left" });
        note(`[session] ${member.session.roomCode}: ${member.player.name} saved and quit`);
        // The quitter's entry is already saved; this only covers the last connected member going.
        saveEmptiedRun(member.session);
        return;
      }

      if (message.type === "setAppearance") {
        const set = store.setAppearance(playerId, message.appearance);
        if (!set.ok) {
          sendError(socket, set.code, set.message);
          return;
        }

        // A designed character is a room member from now on, so the room save learns of them now.
        saveSessionRoom(set.member.session);
        // No message of its own: the next tick's snapshots carry the look to the whole party.
        note(`[session] ${set.member.session.roomCode}: ${set.member.player.name} designed a character`);
        return;
      }

      if (REFUSED_WHILE_DESIGNING.has(message.type)) {
        const member = store.findMember(playerId);
        if (member && !isSpawned(member.player)) {
          send(socket, {
            type: "actionRejected",
            sequence: "sequence" in message ? message.sequence : null,
            reason: "notPermitted",
          });
          return;
        }
      }

      if (message.type === "setReady") {
        const member = store.setReady(playerId, message.ready);
        if (!member) {
          sendError(socket, "notInSession", "Join a dungeon before sending this message");
          return;
        }

        broadcast(member.session, {
          type: "playerReadyChanged",
          playerId: member.player.id,
          ready: member.player.ready,
        });
        return;
      }

      if (message.type === "playerMoveIntent") {
        const member = store.findMember(playerId);
        if (!member) {
          sendError(socket, "notInSession", "Join a dungeon before sending this message");
          return;
        }

        const moved = movePlayer(member.session, playerId, message.direction, now());
        if (!moved.ok) {
          send(socket, {
            type: "actionRejected",
            sequence: message.sequence,
            reason: moved.reason,
          });
          return;
        }

        // A step onto a plate fires it now rather than at the next tick, so the snapshot the tick
        // sends already carries the result. The action only mutates state; the 20 Hz tick below is
        // the sole sender of snapshots, so input rate never multiplies visibility work.
        resolveTraps(member.session, now());
        resolvePuzzles(member.session, now());
        return;
      }

      if (message.type === "playerAttack") {
        const member = store.findMember(playerId);
        if (!member) {
          sendError(socket, "notInSession", "Join a dungeon before sending this message");
          return;
        }

        const attack = resolvePlayerAttack(
          member.session,
          playerId,
          message.direction,
          message.targetId,
          now(),
        );
        if (!attack.ok) {
          send(socket, { type: "actionRejected", sequence: message.sequence, reason: attack.reason });
          return;
        }

        broadcast(member.session, attack.event);
        return;
      }

      if (message.type === "beginDraw" || message.type === "releaseDraw") {
        const member = store.findMember(playerId);
        if (!member) {
          sendError(socket, "notInSession", "Join a dungeon before sending this message");
          return;
        }

        const draw =
          message.type === "beginDraw"
            ? beginDraw(member.session, playerId, message.direction, now())
            : releaseDraw(member.session, playerId, message.direction, now());
        if (!draw.ok) {
          send(socket, { type: "actionRejected", sequence: message.sequence, reason: draw.reason });
        }
        return;
      }

      if (message.type === "buyCosmetic" || message.type === "equipCosmetic") {
        const member = store.findMember(playerId);
        if (!member) {
          sendError(socket, "notInSession", "Join a dungeon before sending this message");
          return;
        }

        const result =
          message.type === "buyCosmetic"
            ? buyCosmetic(member.session, playerId, message.id)
            : equipCosmetic(member.session, playerId, message.slot, message.id);
        if (!result.ok) {
          send(socket, { type: "actionRejected", sequence: null, reason: result.reason });
          return;
        }

        // Ownership reaches the buyer in their next `progressionUpdated`, and what is worn reaches
        // everyone in the next snapshot. Only the profile needs writing now.
        flushPersistent();
        return;
      }

      if (
        message.type === "pickupItem" ||
        message.type === "useItem" ||
        message.type === "convertSkillScroll" ||
        message.type === "buySkillScroll" ||
        message.type === "dropItem" ||
        message.type === "giveItem" ||
        message.type === "swapHeld" ||
        message.type === "withdrawVaultItem" ||
        message.type === "depositVaultItem" ||
        message.type === "playerInteract"
      ) {
        const member = store.findMember(playerId);
        if (!member) {
          sendError(socket, "notInSession", "Join a dungeon before sending this message");
          return;
        }

        const result =
          message.type === "pickupItem"
            ? pickupItem(member.session, playerId, message.itemId)
            : message.type === "useItem"
              ? useItem(member.session, playerId, message.itemId, now(), message.targetPlayerId ?? null)
              : message.type === "convertSkillScroll"
                ? convertSkillScroll(member.session, playerId, message.itemId)
                : message.type === "buySkillScroll"
                ? buySkillScroll(member.session, playerId, message.itemId)
                : message.type === "dropItem"
                ? dropItem(member.session, playerId, message.itemId)
                : message.type === "giveItem"
                  ? giveItem(member.session, playerId, message.itemId, message.targetPlayerId)
                  : message.type === "swapHeld"
                    ? swapHeld(member.session, playerId, message.itemId)
                    : message.type === "withdrawVaultItem"
                      ? withdrawVaultItem(member.session, playerId, message.itemId)
                      : message.type === "depositVaultItem"
                        ? depositVaultItem(member.session, playerId, message.itemId)
                        : interact(member.session, playerId, message.targetId, now());
        if (!result.ok) {
          // These messages carry no sequence number, so the rejection cannot name one.
          send(socket, { type: "actionRejected", sequence: null, reason: result.reason });
          return;
        }

        // The dungeon exit lives behind `playerInteract`, so this is where an escape deposits, and
        // the vault messages change the vault directly. A no-op unless a profile or a vault changed,
        // which opening a door does not.
        flushPersistent();
        return;
      }

      if (message.type === "liftPlayer" || message.type === "dropCarry") {
        const member = store.findMember(playerId);
        if (!member) {
          sendError(socket, "notInSession", "Join a dungeon before sending this message");
          return;
        }

        const result =
          message.type === "liftPlayer"
            ? liftPlayer(member.session, playerId, message.targetPlayerId)
            : dropCarry(member.session, playerId);
        if (!result.ok) {
          send(socket, { type: "actionRejected", sequence: null, reason: result.reason });
          return;
        }

        return;
      }

      if (message.type === "voiceSignal") {
        const member = store.findMember(playerId);
        if (!member) {
          sendError(socket, "notInSession", "Join a dungeon before sending this message");
          return;
        }

        // Charged before the target is checked, so refused signals cannot be used to flood either.
        if (!signalLimiter.tryConsume(playerId, now())) {
          sendError(socket, "rateLimited", "Too many voice signals; slow down");
          return;
        }

        const target = resolveSignalTarget(member.session, playerId, message.targetPlayerId);
        const targetSocket = target.ok ? socketsByPlayer.get(target.target.id) : undefined;
        if (!target.ok || !targetSocket) {
          sendError(
            socket,
            "signalTargetUnavailable",
            target.ok ? "That player is disconnected" : target.message,
          );
          return;
        }

        send(targetSocket, signalRelayFor(playerId, message.signal));
        return;
      }

      if (message.type === "emote") {
        const member = store.findMember(playerId);
        if (!member) {
          sendError(socket, "notInSession", "Join a dungeon before sending this message");
          return;
        }

        const refusal = emoteRefusal(member.player, message.kind);
        if (refusal) {
          send(socket, { type: "actionRejected", sequence: null, reason: refusal });
          return;
        }

        if (!emoteLimiter.tryConsume(playerId, now())) {
          sendError(socket, "rateLimited", "Too many emotes; slow down");
          return;
        }

        const emoted = playerEmotedFor(member.session, member.player, message.kind);
        for (const viewerId of emoteAudience(member.session, member.player)) {
          const viewerSocket = socketsByPlayer.get(viewerId);
          if (viewerSocket) send(viewerSocket, emoted);
        }
        return;
      }

      // Every client message is handled above. A message added to the protocol fails to compile
      // here until it is handled, and answers `notImplemented` if a build skipped the check.
      const unhandled: never = message;
      sendError(
        socket,
        "notImplemented",
        `"${(unhandled as { type: string }).type}" is accepted by the protocol but not handled yet`,
      );
    });

    socket.on("close", () => {
      if (playerId === null) return;

      const member = store.markDisconnected(playerId);
      socketsByPlayer.delete(playerId);
      lastProgressionSent.delete(playerId);
      playerId = null;

      if (member) {
        broadcast(member.session, {
          type: "playerConnectionChanged",
          playerId: member.player.id,
          connected: false,
        });
        note(`[session] ${member.session.roomCode}: ${member.player.name} disconnected, holding slot`);
        saveEmptiedRun(member.session);
      }
    });

    socket.on("error", (error) => {
      console.error("[ws] socket error:", error);
    });
  });

  const tickTimer = setInterval(() => {
    const at = now();
    const sessionCount = store.sessionCount;

    for (const session of store.listSessions()) {
      // Dungeon simulation advances even with nobody watching, so a reconnecting party returns to
      // a world that kept its timers rather than one frozen mid-fight.
      const monsterAttacks = simulate(session, at);
      const hasAudience = [...session.players.values()].some((player) => player.connected);
      if (hasAudience) {
        for (const attack of monsterAttacks) broadcast(session, attack);
      }
      // Plates ready and unready players exactly as the button does, so each change goes out the same
      // way a `setReady` does.
      for (const change of resolveReadyPlates(session)) {
        broadcast(session, {
          type: "playerReadyChanged",
          playerId: change.player.id,
          ready: change.player.ready,
          ...(change.partyReady ? { partyReady: true as const } : {}),
        });
      }

      if (partyWiped(session)) {
        // The party is shown going down before it is moved home. A client tells a wipe from an
        // escape by whether it saw itself downed, and the blow that wipes a party lands in the same
        // tick as the return, so the return waits one tick: this tick's snapshot shows the party
        // downed, the next one shows the hub.
        if (hasAudience && !wipeAnnounced.has(session)) {
          wipeAnnounced.add(session);
        } else {
          wipeAnnounced.delete(session);
          returnToHub(session, false);
          // A wipe costs everyone their carry, which is a profile change like any other.
          flushPersistent();
        }
      }
      session.tick += 1;

      if (!hasAudience) continue;
      // After positions settle and before snapshots, so merged tiles ride this tick's delta.
      shareDiscoveredMaps(session);
      broadcastSnapshots(session);
    }

    const elapsedMs = now() - at;
    if (
      elapsedMs >= slowTickMs &&
      (lastSlowTickLoggedAt === null || at - lastSlowTickLoggedAt >= SLOW_TICK_LOG_INTERVAL_MS)
    ) {
      lastSlowTickLoggedAt = at;
      note(
        `[tick] slow tick: ${elapsedMs.toFixed(1)} ms across ${sessionCount} session(s), ` +
          `budget ${tickIntervalMs} ms`,
      );
    }
  }, tickIntervalMs);

  const autosaveTimer = setInterval(() => {
    for (const session of store.listSessions()) {
      if (session.location === "dungeon" && session.players.size > 0) saveSessionRoom(session);
    }
  }, autosaveIntervalMs);

  const sweepTimer = setInterval(() => {
    // Before the sweep drops a timed-out player or an emptied session, so what it forgets is saved.
    for (const session of store.listSessions()) saveEmptiedRun(session);
    // The safety net under the targeted flushes above, for any change they did not cover.
    flushPersistent();

    for (const member of store.sweep()) {
      socketsByPlayer.delete(member.player.id);
      lastProgressionSent.delete(member.player.id);
      lastRosterSent.delete(member.player.id);
      lastVaultSent.delete(member.player.id);
      lastStockSent.delete(member.player.id);
      signalLimiter.forget(member.player.id);
      emoteLimiter.forget(member.player.id);
      broadcast(member.session, {
        type: "playerLeft",
        playerId: member.player.id,
        reason: "timedOut",
      });
      note(`[session] ${member.session.roomCode}: ${member.player.name} timed out, slot released`);
    }
  }, sweepIntervalMs);

  return {
    httpServer,
    store,
    profiles,
    listen(port, host) {
      return new Promise((resolve, reject) => {
        const onError = (error: Error): void => {
          httpServer.off("listening", onListening);
          reject(error);
        };
        const onListening = (): void => {
          httpServer.off("error", onError);
          resolve(httpServer.address() as AddressInfo);
        };

        httpServer.once("error", onError);
        httpServer.once("listening", onListening);
        httpServer.listen(port, host);
      });
    },
    close() {
      clearInterval(tickTimer);
      clearInterval(sweepTimer);
      clearInterval(autosaveTimer);
      // Last chance to save: after this the timers are gone and nothing else will write. Every run
      // in progress is written first, so a restart loses at most what happened since this call.
      for (const session of store.listSessions()) {
        if (session.location === "dungeon") saveRoom(session, store.saves, now(), wallNow());
      }
      flushPersistent();
      for (const socket of socketsByPlayer.values()) socket.terminate();
      for (const socket of wss.clients) socket.terminate();
      socketsByPlayer.clear();
      lastProgressionSent.clear();
      lastRosterSent.clear();
      lastVaultSent.clear();
      lastStockSent.clear();
      signalLimiter.clear();
      emoteLimiter.clear();
      return new Promise((resolve) => {
        wss.close(() => httpServer.close(() => resolve()));
      });
    },
  };
}
