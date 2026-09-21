import { randomBytes, randomInt, randomUUID } from "node:crypto";
import {
  EMPTY_SESSION_TTL_MS,
  MAX_PARTY_SIZE,
  PLAYER_BASE_RESISTANCE,
  PLAYER_MAX_HEALTH,
  PLAYER_MAX_STAMINA,
  PLAYER_SPAWN_FACING,
  RECONNECT_GRACE_MS,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
} from "../../shared/constants/game.js";
import type { ErrorCode } from "../../shared/protocol/index.js";
import type {
  DungeonState,
  EntityId,
  InventoryItem,
  PlayerId,
  PlayerName,
  PlayerState,
  ProfileId,
  ResumeToken,
  RoomCode,
  SessionLocation,
  SessionId,
  Vector2,
} from "../../shared/types/core.js";
import {
  buildDungeon,
  findSpawnPoint,
  HUB_DUNGEON_ID,
  type DungeonRequest,
} from "../game/dungeonState.js";
import { contentForSession, effectiveResistance } from "../game/progression.js";
import type { PlayerProfile } from "../profiles/profile.js";

export interface SessionPlayer {
  id: PlayerId;
  name: PlayerName;
  position: Vector2;
  facing: Vector2;
  /** Zero means downed: the player cannot act and blocks nobody until the run ends or they revive. */
  health: number;
  /**
   * Damage reduction, stored unrounded because decay moves it by fractions of a point per tick.
   * Only `src/server/game/vitals.ts` writes it.
   */
  resistance: number;
  /** Action budget, stored unrounded for the same reason. */
  stamina: number;
  ready: boolean;
  connected: boolean;
  inventory: InventoryItem[];
  /** Skills learned from consumed scrolls this run, provisional until this player extracts. */
  runSkillIds: Set<string>;
  /** Equipped separately from the three inventory slots. Picked up deliberately in hub or dungeon. */
  carryingTorch: boolean;
  /**
   * The roguelite profile playing this slot, owned by `ProfileStore` and shared by reference.
   *
   * Banked items and unlocks live on it rather than on the player, so what a run earns outlives the
   * session that earned it. One profile may play only one slot at a time, which `join` enforces.
   */
  profile: PlayerProfile;
  /** Server-side memory of map tiles this player has seen at least once. */
  discoveredTiles: Set<string>;
  /**
   * Rooms this player has seen any part of. Kept alongside `discoveredTiles` rather than derived
   * from it: a scaled room is a couple of thousand tiles, and re-deriving this every tick is work
   * that grows with the map for an answer that only ever changes while exploring.
   */
  discoveredRoomIds: Set<string>;
  /** Server-side only. Leaves the process solely in this player's own `sessionJoined`. */
  resumeToken: ResumeToken;
  /** When the socket dropped, or null while connected. Drives the reconnect grace window. */
  disconnectedAt: number | null;
  /** Server clock time the next move is due, or null before the first. Paces movement speed. */
  nextMoveAt: number | null;
  /** Server clock time the next attack is allowed, or null before the first. */
  nextAttackAt: number | null;
  /**
   * Server clock time this player entered the dungeon, which is when their resistance clock starts.
   * Set when a ready party leaves the hub. Null in the hub.
   */
  enteredDungeonAt: number | null;
}

export interface Session {
  id: SessionId;
  roomCode: RoomCode;
  createdAt: number;
  dungeon: DungeonState;
  /** The party always shares one place, which keeps voice, visibility, and snapshots coherent. */
  location: SessionLocation;
  /** What to generate when the ready party uses the hub entrance. */
  runDungeon: DungeonRequest;
  /**
   * Where players enter. Owned by the dungeon rather than by a module constant, because a generated
   * dungeon puts its entrance somewhere different every run.
   */
  spawnPoints: Vector2[];
  /**
   * The seed this dungeon was generated from, or null for an authored one. Kept so a run can be
   * reproduced from a bug report, and logged when a session is created.
   */
  seed: number | null;
  /** Monotonic simulation tick, stamped onto each snapshot so clients can order what they receive. */
  tick: number;
  players: Map<PlayerId, SessionPlayer>;
  /** Server clock time of the last simulation step, or null before the first. */
  simulatedAt: number | null;
  /** When each monster may attack again. Server-side only, so clients never see monster timing. */
  monsterCooldowns: Map<EntityId, number>;
}

export interface JoinRequest {
  roomCode: RoomCode;
  playerName: PlayerName;
  resumeToken?: ResumeToken | null;
  /**
   * The profile the caller's secret named, or null when it named none.
   *
   * Resolved by the caller rather than here, because this store owns sessions and knows nothing
   * about where profiles are kept. Null means the join will mint one, which is why `createProfile`
   * is a callback: an unrecognised secret paired with a mistyped room code should leave nothing
   * behind.
   */
  profile: PlayerProfile | null;
  createProfile: () => PlayerProfile;
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
  /** Which dungeon new sessions get. Tests pin a seed here to make a generated run repeatable. */
  dungeon?: DungeonRequest;
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
  readonly #dungeon: DungeonRequest;

  constructor(options: SessionStoreOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#createPlayerId = options.createPlayerId ?? randomUUID;
    this.#createSessionId = options.createSessionId ?? randomUUID;
    this.#createResumeToken = options.createResumeToken ?? (() => randomBytes(16).toString("hex"));
    this.#createRoomCode = options.createRoomCode ?? defaultRoomCode;
    this.#maxPartySize = options.maxPartySize ?? MAX_PARTY_SIZE;
    this.#reconnectGraceMs = options.reconnectGraceMs ?? RECONNECT_GRACE_MS;
    this.#emptySessionTtlMs = options.emptySessionTtlMs ?? EMPTY_SESSION_TTL_MS;
    this.#dungeon = options.dungeon ?? {};
  }

  createSession(): Session {
    let roomCode = this.#createRoomCode();
    for (let attempt = 0; this.#sessions.has(roomCode); attempt += 1) {
      if (attempt >= 50) {
        throw new Error("Unable to allocate an unused room code");
      }
      roomCode = this.#createRoomCode();
    }

    const built = buildDungeon({ dungeonId: HUB_DUNGEON_ID, content: this.#dungeon.content });
    const session: Session = {
      id: this.#createSessionId(),
      roomCode,
      createdAt: this.#now(),
      dungeon: built.dungeon,
      location: "hub",
      runDungeon: { ...this.#dungeon },
      spawnPoints: built.spawnPoints,
      seed: built.seed,
      tick: 0,
      players: new Map(),
      simulatedAt: null,
      monsterCooldowns: new Map(),
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
      // erroring. The location check below decides whether a fresh join is currently allowed.
    }

    // Checked after the resume branch, never before it: the slot a reconnecting player is
    // reclaiming already holds their profile, and that is exactly the case this would refuse.
    if (request.profile && this.#playerWithProfile(request.profile.id)) {
      return {
        ok: false,
        code: "profileInUse",
        message:
          "This profile is already playing in a dungeon. Leave that party, or wait for its slot to time out",
      };
    }

    if (session.location === "dungeon") {
      return {
        ok: false,
        code: "runInProgress",
        message: "This party is already in a dungeon run; wait for them to return to the hub",
      };
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
      resistance: PLAYER_BASE_RESISTANCE,
      stamina: PLAYER_MAX_STAMINA,
      ready: false,
      connected: true,
      inventory: [],
      runSkillIds: new Set(),
      carryingTorch: false,
      profile: request.profile ?? request.createProfile(),
      discoveredTiles: new Set(),
      discoveredRoomIds: new Set(),
      resumeToken: this.#createResumeToken(),
      disconnectedAt: null,
      nextMoveAt: null,
      nextAttackAt: null,
      enteredDungeonAt: null,
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

  /**
   * The slot a profile currently occupies anywhere on this server, or undefined when it is free.
   *
   * Across every session rather than just the one being joined: a profile is one bank, and two
   * parties spending it at once would let the same items be banked twice or lost twice. A slot held
   * open for a disconnected player still counts, because it is still theirs to come back to.
   */
  #playerWithProfile(profileId: ProfileId): SessionMember | undefined {
    for (const session of this.#sessions.values()) {
      for (const player of session.players.values()) {
        if (player.profile.id === profileId) return { session, player };
      }
    }
    return undefined;
  }

  #removePlayer({ session, player }: SessionMember): void {
    session.players.delete(player.id);
    this.#sessionByPlayer.delete(player.id);
  }
}

/**
 * Public view of a player. Drops `resumeToken`, `disconnectedAt`, and pacing timers, which are never
 * broadcast. Resistance and stamina are rounded here: they move by fractions of a point per tick on
 * the server, and a HUD bar has no use for that precision.
 */
export function toPlayerState(player: SessionPlayer, session?: Session): PlayerState {
  const resistance = session
    ? effectiveResistance(player, contentForSession(session))
    : effectiveResistance(player);
  return {
    id: player.id,
    name: player.name,
    position: { ...player.position },
    facing: { ...player.facing },
    health: player.health,
    resistance: Math.round(resistance),
    stamina: Math.round(player.stamina),
    ready: player.ready,
    connected: player.connected,
    inventory: player.inventory.map((item) => ({ ...item })),
    carryingTorch: player.carryingTorch,
    bankedItems: player.profile.bankedItems.map((item) => ({ ...item })),
  };
}

export function rosterOf(session: Session): PlayerState[] {
  return [...session.players.values()].map((player) => toPlayerState(player, session));
}
