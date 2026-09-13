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
import { SessionStore, rosterOf, toPlayerState, type Session } from "./sessions/sessionStore.js";

const DEFAULT_SWEEP_INTERVAL_MS = 5_000;

export interface GameServerOptions {
  store?: SessionStore;
  tickIntervalMs?: number;
  sweepIntervalMs?: number;
  /** Set false in tests to keep the reporter readable. */
  log?: boolean;
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
  const log = options.log ?? true;

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

  const httpServer = createServer((request, response) => {
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

  const wss = new WebSocketServer({ server: httpServer });

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
          players: rosterOf(session),
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
    for (const session of store.listSessions()) {
      session.tick += 1;

      const hasAudience = [...session.players.values()].some((player) => player.connected);
      if (!hasAudience) continue;

      broadcast(session, {
        type: "stateSnapshot",
        tick: session.tick,
        players: rosterOf(session),
      });
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
      return new Promise((resolve) => {
        httpServer.listen(port, host, () => resolve(httpServer.address() as AddressInfo));
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
