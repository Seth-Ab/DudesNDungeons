import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocketServer, type WebSocket } from "ws";
import {
  MAX_PARTY_SIZE,
  PROTOCOL_VERSION,
  SERVER_TICK_MS,
  SERVER_TICK_RATE_HZ,
} from "../shared/constants/game.js";
import {
  parseClientMessage,
  serializeServerMessage,
  type ErrorCode,
  type ServerMessage,
} from "../shared/protocol/index.js";
import type { PlayerId } from "../shared/types/core.js";
import { resolvePlayerAttack, simulate } from "./game/combat.js";
import { movePlayer } from "./game/dungeonState.js";
import { interact, pickupItem, useItem } from "./game/items.js";
import { visibilityFrameForPlayer, voiceRangeForPlayer } from "./game/visibility.js";
import { runStateFor } from "./game/vitals.js";
import { SessionStore, toPlayerState, type Session } from "./sessions/sessionStore.js";

const DEFAULT_SWEEP_INTERVAL_MS = 5_000;

export interface GameServerOptions {
  store?: SessionStore;
  tickIntervalMs?: number;
  sweepIntervalMs?: number;
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
  const tickIntervalMs = options.tickIntervalMs ?? SERVER_TICK_MS;
  const sweepIntervalMs = options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
  const allowedOrigin = options.allowedOrigin ?? "*";
  const log = options.log ?? true;
  const now = options.now ?? (() => performance.now());

  const socketsByPlayer = new Map<PlayerId, WebSocket>();

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
  function sendSnapshot(session: Session, playerId: PlayerId): void {
    const socket = socketsByPlayer.get(playerId);
    if (!socket) return;

    const player = session.players.get(playerId);
    if (!player) return;

    const frame = visibilityFrameForPlayer(session, player);
    send(socket, {
      type: "stateSnapshot",
      tick: session.tick,
      players: frame.players,
      dungeon: frame.dungeon,
      // The run clock belongs to the viewer, not the party: a player who joined late has been in
      // the dungeon for less time and their resistance reflects that.
      run: runStateFor(player, now()),
    });
    send(socket, voiceRangeForPlayer(session, player, frame));
  }

  function broadcastSnapshots(session: Session): void {
    for (const player of session.players.values()) {
      sendSnapshot(session, player.id);
    }
  }

  /** After an action changes the dungeon, advance the tick and send everyone the new state now. */
  function publish(session: Session): void {
    session.tick += 1;
    broadcastSnapshots(session);
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

    socket.on("message", (data) => {
      const result = parseClientMessage(data.toString());

      if (!result.ok) {
        note(`[ws] rejected message: ${result.error}`);
        sendError(socket, "invalidMessage", result.error);
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

        const joined = store.join({
          roomCode: message.roomCode,
          playerName: message.playerName,
          resumeToken: message.resumeToken,
        });

        if (!joined.ok) {
          sendError(socket, joined.code, joined.message);
          return;
        }

        const { session, player, resumed } = joined;
        playerId = player.id;
        socketsByPlayer.set(player.id, socket);

        // Carries the resume token, so it goes to this player alone and never through broadcast().
        send(socket, {
          type: "sessionJoined",
          sessionId: session.id,
          roomCode: session.roomCode,
          playerId: player.id,
          resumeToken: player.resumeToken,
          resumed,
          tickRate: SERVER_TICK_RATE_HZ,
          players: visibilityFrameForPlayer(session, player).players,
        });

        broadcast(
          session,
          resumed
            ? { type: "playerConnectionChanged", playerId: player.id, connected: true }
            : { type: "playerJoined", player: toPlayerState(player) },
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
        playerId = null;

        if (member) {
          broadcast(member.session, {
            type: "playerLeft",
            playerId: member.player.id,
            reason: "left",
          });
          note(`[session] ${member.session.roomCode}: ${member.player.name} left`);
        }
        return;
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

        publish(member.session);
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
        publish(member.session);
        return;
      }

      if (
        message.type === "pickupItem" ||
        message.type === "useItem" ||
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
              ? useItem(member.session, playerId, message.itemId)
              : interact(member.session, playerId, message.targetId);
        if (!result.ok) {
          // These messages carry no sequence number, so the rejection cannot name one.
          send(socket, { type: "actionRejected", sequence: null, reason: result.reason });
          return;
        }

        publish(member.session);
        return;
      }

      sendError(
        socket,
        "notImplemented",
        `"${message.type}" is accepted by the protocol but not handled yet`,
      );
    });

    socket.on("close", () => {
      if (playerId === null) return;

      const member = store.markDisconnected(playerId);
      socketsByPlayer.delete(playerId);
      playerId = null;

      if (member) {
        broadcast(member.session, {
          type: "playerConnectionChanged",
          playerId: member.player.id,
          connected: false,
        });
        note(`[session] ${member.session.roomCode}: ${member.player.name} disconnected, holding slot`);
      }
    });

    socket.on("error", (error) => {
      console.error("[ws] socket error:", error);
    });
  });

  const tickTimer = setInterval(() => {
    const at = now();

    for (const session of store.listSessions()) {
      // Monsters and respawns advance even with nobody watching, so a reconnecting party returns to
      // a world that kept its timers rather than one frozen mid-fight.
      const monsterAttacks = simulate(session, at);
      session.tick += 1;

      const hasAudience = [...session.players.values()].some((player) => player.connected);
      if (!hasAudience) continue;

      for (const attack of monsterAttacks) broadcast(session, attack);
      broadcastSnapshots(session);
    }
  }, tickIntervalMs);

  const sweepTimer = setInterval(() => {
    for (const member of store.sweep()) {
      socketsByPlayer.delete(member.player.id);
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
      for (const socket of socketsByPlayer.values()) socket.terminate();
      for (const socket of wss.clients) socket.terminate();
      socketsByPlayer.clear();
      return new Promise((resolve) => {
        wss.close(() => httpServer.close(() => resolve()));
      });
    },
  };
}
