import { randomBytes, randomInt, randomUUID } from "node:crypto";
import {
  EMPTY_SESSION_TTL_MS,
  MAX_PARTY_SIZE,
  PLAYER_MAX_HEALTH,
  PLAYER_SPAWN_FACING,
  RECONNECT_GRACE_MS,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
} from "../../shared/constants/game.js";
import type { ErrorCode } from "../../shared/protocol/index.js";
import type {
  PlayerId,
  PlayerName,
  PlayerState,
  ResumeToken,
  RoomCode,
  SessionId,
  DungeonState,
  Vector2,
} from "../../shared/types/core.js";
import { createDungeonState, findSpawnPoint } from "../game/dungeonState.js";

export interface SessionPlayer {
  id: PlayerId;
  name: PlayerName;
  position: Vector2;
  facing: Vector2;
  health: number;
  ready: boolean;
  connected: boolean;
  /** Server-side only. Leaves the process solely in this player's own `sessionJoined`. */
  resumeToken: ResumeToken;
  /** When the socket dropped, or null while connected. Drives the reconnect grace window. */
  disconnectedAt: number | null;
  /** Server clock time the next move is due, or null before the first. Paces movement speed. */
  nextMoveAt: number | null;
}

export interface Session {
  id: SessionId;
  roomCode: RoomCode;
  createdAt: number;
  dungeon: DungeonState;
  /** Monotonic simulation tick, stamped onto each snapshot so clients can order what they receive. */
  tick: number;
  players: Map<PlayerId, SessionPlayer>;
}

export interface JoinRequest {
  roomCode: RoomCode;
  playerName: PlayerName;
  resumeToken?: ResumeToken | null;
}

export type JoinResult =
  | { ok: true; resumed: boolean; session: Session; player: SessionPlayer }
  | { ok: false; code: ErrorCode; message: string };

export interface SessionMember {
  session: Session;
  player: SessionPlayer;
}

export interface SessionStoreOptions {
  now?: () => number;
  createPlayerId?: () => PlayerId;
  createSessionId?: () => SessionId;
  createResumeToken?: () => ResumeToken;
  createRoomCode?: () => RoomCode;
  maxPartySize?: number;
  reconnectGraceMs?: number;
  emptySessionTtlMs?: number;
}

function defaultRoomCode(): RoomCode {
  let code = "";
  for (let index = 0; index < ROOM_CODE_LENGTH; index += 1) {
    code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * Authoritative registry of dungeon instances and their players.
 *
 * Deliberately free of transport types: it is fed plain requests and returns plain results, so the
 * WebSocket layer owns sockets and this owns rules. That split is what makes the lifecycle
 * testable without opening a port.
 */
export class SessionStore {
  readonly #sessions = new Map<RoomCode, Session>();
  /** Reverse index so socket events, which only carry a player id, resolve in constant time. */
  readonly #sessionByPlayer = new Map<PlayerId, RoomCode>();

  readonly #now: () => number;
  readonly #createPlayerId: () => PlayerId;
  readonly #createSessionId: () => SessionId;
  readonly #createResumeToken: () => ResumeToken;
  readonly #createRoomCode: () => RoomCode;
  readonly #maxPartySize: number;
  readonly #reconnectGraceMs: number;
  readonly #emptySessionTtlMs: number;

  constructor(options: SessionStoreOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#createPlayerId = options.createPlayerId ?? randomUUID;
    this.#createSessionId = options.createSessionId ?? randomUUID;
    this.#createResumeToken = options.createResumeToken ?? (() => randomBytes(16).toString("hex"));
    this.#createRoomCode = options.createRoomCode ?? defaultRoomCode;
    this.#maxPartySize = options.maxPartySize ?? MAX_PARTY_SIZE;
    this.#reconnectGraceMs = options.reconnectGraceMs ?? RECONNECT_GRACE_MS;
    this.#emptySessionTtlMs = options.emptySessionTtlMs ?? EMPTY_SESSION_TTL_MS;
  }

  createSession(): Session {
    let roomCode = this.#createRoomCode();
    for (let attempt = 0; this.#sessions.has(roomCode); attempt += 1) {
      if (attempt >= 50) {
        throw new Error("Unable to allocate an unused room code");
      }
      roomCode = this.#createRoomCode();
    }

    const session: Session = {
      id: this.#createSessionId(),
      roomCode,
      createdAt: this.#now(),
      dungeon: createDungeonState(),
      tick: 0,
      players: new Map(),
    };
    this.#sessions.set(roomCode, session);
    return session;
  }

  getSession(roomCode: RoomCode): Session | undefined {
    return this.#sessions.get(roomCode);
  }

  findMember(playerId: PlayerId): SessionMember | undefined {
    const roomCode = this.#sessionByPlayer.get(playerId);
    if (roomCode === undefined) return undefined;

    const session = this.#sessions.get(roomCode);
    const player = session?.players.get(playerId);
    return session && player ? { session, player } : undefined;
  }

  get sessionCount(): number {
    return this.#sessions.size;
  }

  listSessions(): Session[] {
    return [...this.#sessions.values()];
  }

  join(request: JoinRequest): JoinResult {
    const session = this.#sessions.get(request.roomCode);
    if (!session) {
      return { ok: false, code: "sessionNotFound", message: "No dungeon exists for that room code" };
    }

    if (request.resumeToken) {
      const existing = [...session.players.values()].find(
        (candidate) => candidate.resumeToken === request.resumeToken,
      );

      if (existing?.connected) {
        return {
          ok: false,
          code: "alreadyInSession",
          message: "That player is already connected to this dungeon",
        };
      }

      if (existing) {
        existing.connected = true;
        existing.disconnectedAt = null;
        // Game state (position, health, ready) is preserved; the display name is refreshed because
        // it is presentation the player may have changed before reconnecting.
        existing.name = request.playerName;
        return { ok: true, resumed: true, session, player: existing };
      }
      // An unknown token means the slot already timed out. Fall through to a fresh join rather than
      // erroring, so a client returning from a long outage still lands in the dungeon.
    }

    if (session.players.size >= this.#maxPartySize) {
      return { ok: false, code: "sessionFull", message: "This dungeon is full" };
    }

    const player: SessionPlayer = {
      id: this.#createPlayerId(),
      name: request.playerName,
      position: findSpawnPoint(session),
      facing: { ...PLAYER_SPAWN_FACING },
      health: PLAYER_MAX_HEALTH,
      ready: false,
      connected: true,
      resumeToken: this.#createResumeToken(),
      disconnectedAt: null,
      nextMoveAt: null,
    };

    session.players.set(player.id, player);
    this.#sessionByPlayer.set(player.id, session.roomCode);
    return { ok: true, resumed: false, session, player };
  }

  setReady(playerId: PlayerId, ready: boolean): SessionMember | undefined {
    const member = this.findMember(playerId);
    if (!member) return undefined;

    member.player.ready = ready;
    return member;
  }

  /** Explicit, terminal departure. The slot is released immediately. */
  leave(playerId: PlayerId): SessionMember | undefined {
    const member = this.findMember(playerId);
    if (!member) return undefined;

    this.#removePlayer(member);
    return member;
  }

  /**
   * The socket dropped. The player keeps their slot and game state until the grace window expires,
   * so a refresh or a brief network blip is not a wipe.
   */
  markDisconnected(playerId: PlayerId): SessionMember | undefined {
    const member = this.findMember(playerId);
    if (!member || !member.player.connected) return undefined;

    member.player.connected = false;
    member.player.disconnectedAt = this.#now();
    return member;
  }

  /**
   * Drops players whose grace window expired and sessions left empty past their TTL. Callers
   * broadcast a `playerLeft` with reason `timedOut` for each member returned.
   */
  sweep(): SessionMember[] {
    const now = this.#now();
    const timedOut: SessionMember[] = [];

    for (const session of this.#sessions.values()) {
      for (const player of session.players.values()) {
        if (
          player.disconnectedAt !== null &&
          now - player.disconnectedAt >= this.#reconnectGraceMs
        ) {
          timedOut.push({ session, player });
        }
      }
    }

    for (const member of timedOut) {
      this.#removePlayer(member);
    }

    for (const session of this.#sessions.values()) {
      if (session.players.size === 0 && now - session.createdAt >= this.#emptySessionTtlMs) {
        this.#sessions.delete(session.roomCode);
      }
    }

    return timedOut;
  }

  #removePlayer({ session, player }: SessionMember): void {
    session.players.delete(player.id);
    this.#sessionByPlayer.delete(player.id);
  }
}

/**
 * Public view of a player. Drops `resumeToken`, `disconnectedAt`, and `nextMoveAt`, which are never
 * broadcast.
 */
export function toPlayerState(player: SessionPlayer): PlayerState {
  return {
    id: player.id,
    name: player.name,
    position: { ...player.position },
    facing: { ...player.facing },
    health: player.health,
    ready: player.ready,
    connected: player.connected,
  };
}

export function rosterOf(session: Session): PlayerState[] {
  return [...session.players.values()].map(toPlayerState);
}
