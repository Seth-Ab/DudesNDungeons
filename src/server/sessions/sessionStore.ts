import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { PARTY_COLORS } from "../../shared/constants/appearance.js";
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
import type { ErrorCode, PartyRosterEntry } from "../../shared/protocol/index.js";
import type {
  DungeonState,
  EntityId,
  InventoryItem,
  PartyColor,
  PlayerAppearance,
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
import { lootRngFor } from "../game/monsterLoot.js";
import { pressReady } from "../game/readyPlates.js";
import { standUp } from "../game/seats.js";
import type { DummyHit } from "../game/dummies.js";
import type { Draw } from "../game/bow.js";
import type { ChargeRun, ProjectileRun } from "../game/monsterAttacks.js";
import type { MonsterPost } from "../game/monsterAi.js";
import type { Rng } from "../game/random.js";
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
  /** In hand, independent of `inventory` and the torch. */
  held: InventoryItem | null;
  /** A bow draw in progress, or null. Server-side clock; see `src/server/game/bow.ts`. */
  draw: Draw | null;
  /** Skills learned from consumed scrolls this run, provisional until this player extracts. */
  runSkillIds: Set<string>;
  /** Equipped separately from the three inventory slots. Picked up deliberately in hub or dungeon. */
  carryingTorch: boolean;
  /** The downed party member this player is carrying, or null. Set only by `src/server/game/carrying.ts`. */
  carryingPlayerId: PlayerId | null;
  /** The player carrying this one, or null. Set only while this player is downed. */
  carriedByPlayerId: PlayerId | null;
  /** The seat this player sits on, or null. Set only by `src/server/game/seats.ts`. */
  seatId: EntityId | null;
  /** The hub ready plate this player holds, or null. Set only by `src/server/game/readyPlates.ts`. */
  readyPlateId: EntityId | null;
  /** True while `ready` was set by the held plate rather than the button, so stepping off clears it. */
  readyFromPlate: boolean;
  /** A plate this player unreadied on with the button. They cannot claim it again until they leave it. */
  declinedPlateId: EntityId | null;
  /**
   * The designed look, or null while the player is still designing it. Null means the slot is held
   * but the player is not in the world: they block nobody, and the server refuses their actions and
   * their ready until `SessionStore.setAppearance` spawns them. Set once and locked for the slot's
   * life; run saves will persist it later.
   */
  appearance: PlayerAppearance | null;
  /** First colour free in the session when the slot was created, kept through reconnects. */
  partyColor: PartyColor;
  /**
   * The roguelite profile playing this slot, owned by `ProfileStore` and shared by reference.
   *
   * Banked items and unlocks live on it rather than on the player, so what a run earns outlives the
   * session that earned it. One profile may play only one slot at a time, which `join` enforces.
   */
  profile: PlayerProfile;
  /**
   * Server-side memory of map tiles this player has seen at least once: 1 per tile, indexed
   * `y * width + x`. Sized to the installed world; empty until visibility first runs on a new one.
   */
  discoveredTiles: Uint8Array;
  /**
   * Rooms this player has seen any part of. Kept alongside `discoveredTiles` rather than derived
   * from it: a scaled room is a couple of thousand tiles, and re-deriving this every tick is work
   * that grows with the map for an answer that only ever changes while exploring.
   */
  discoveredRoomIds: Set<string>;
  /**
   * Every tile index in `discoveredTiles`, in the order it was learned, whether seen or shared.
   * Nearby players merge from the end of each other's log rather than rescanning whole grids; see
   * `mapSharing.ts`. Replaced, not cleared, when the world changes, so a stale cursor is detectable.
   */
  discoveryLog: number[];
  /**
   * Indexes into `discoveredTiles` found since this viewer's last snapshot, which the next one
   * carries as a delta. Only filled while `mapSyncedTo` is the installed world; see `visibility.ts`.
   */
  pendingDiscovery: number[];
  /**
   * The world map this player's client was last given a full baseline of, or null when its client
   * holds none: before the first snapshot, and after a reconnect. A different map object means the
   * world was rebuilt. Either way the next snapshot restarts the client's geometry from scratch.
   */
  mapSyncedTo: object | null;
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
  /**
   * Seeded stream monster drops are rolled from, so the same seed and kill order give the same
   * loot. Server-side only; replaced whenever a world is installed.
   */
  lootRng: Rng;
  /** Monotonic simulation tick, stamped onto each snapshot so clients can order what they receive. */
  tick: number;
  players: Map<PlayerId, SessionPlayer>;
  /** Server clock time of the last simulation step, or null before the first. */
  simulatedAt: number | null;
  /** When each monster may attack again. Server-side only, so clients never see monster timing. */
  monsterCooldowns: Map<EntityId, number>;
  /** When each winding-up monster began its swing. Absent means idle. Server-side only. */
  monsterWindups: Map<EntityId, number>;
  /** Distance travelled by each charging monster, and who it has hit. Absent means not charging. */
  monsterCharges: Map<EntityId, ChargeRun>;
  /** What the server knows about each projectile in flight that clients do not. */
  projectileRuns: Map<EntityId, ProjectileRun>;
  /** Where each monster spawned and whether it is hunting. Server-side only, like the cooldowns. */
  monsterPosts: Map<EntityId, MonsterPost>;
  /** When each triggered, rearming trap may be armed again. Server-side only. */
  trapRearmAt: Map<EntityId, number>;
  /** When each puzzle's plates all became held at once. Absent while any plate is free. */
  puzzleHeldSince: Map<EntityId, number>;
  /** When each burning flare in `dungeon.lightSources` goes out. Server-side only. */
  flareExpiresAt: Map<EntityId, number>;
  /** Hits on each training dummy still inside the readout window. Server-side only. */
  dummyHits: Map<EntityId, DummyHit[]>;
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

export type SetAppearanceResult =
  | { ok: true; member: SessionMember }
  | { ok: false; code: ErrorCode; message: string };

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
      lootRng: lootRngFor(built.seed, HUB_DUNGEON_ID),
      tick: 0,
      players: new Map(),
      simulatedAt: null,
      monsterCooldowns: new Map(),
      monsterWindups: new Map(),
      monsterPosts: new Map(),
      monsterCharges: new Map(),
      projectileRuns: new Map(),
      trapRearmAt: new Map(),
      puzzleHeldSince: new Map(),
      flareExpiresAt: new Map(),
      dummyHits: new Map(),
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

    const partyColor = freePartyColor(session);
    if (session.players.size >= this.#maxPartySize || partyColor === undefined) {
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
      held: null,
      draw: null,
      runSkillIds: new Set(),
      carryingTorch: false,
      carryingPlayerId: null,
      carriedByPlayerId: null,
      seatId: null,
      readyPlateId: null,
      readyFromPlate: false,
      declinedPlateId: null,
      appearance: null,
      partyColor,
      profile: request.profile ?? request.createProfile(),
      discoveredTiles: new Uint8Array(0),
      discoveredRoomIds: new Set(),
      discoveryLog: [],
      pendingDiscovery: [],
      mapSyncedTo: null,
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

  /**
   * Stores a designed look and spawns its player. The look is validated by the protocol schema
   * before it gets here; this owns the rule that it can be set only once per slot.
   *
   * The spawn point is chosen again now rather than kept from the join, because a player who is
   * still designing blocks nobody, so someone else may be standing on the point they were given.
   */
  setAppearance(playerId: PlayerId, appearance: PlayerAppearance): SetAppearanceResult {
    const member = this.findMember(playerId);
    if (!member) {
      return { ok: false, code: "notInSession", message: "Join a dungeon before sending this message" };
    }
    if (member.player.appearance !== null) {
      return {
        ok: false,
        code: "appearanceLocked",
        message: "Your character is already designed and cannot be changed",
      };
    }

    member.player.position = findSpawnPoint(member.session);
    member.player.appearance = { ...appearance };
    return { ok: true, member };
  }

  setReady(playerId: PlayerId, ready: boolean): SessionMember | undefined {
    const member = this.findMember(playerId);
    if (!member) return undefined;

    pressReady(member.player, ready);
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
    member.player.draw = null;
    // Nobody is steering a dropped carrier, so whoever they were hauling is set down where they
    // stand. The reverse is left alone: a carried player is an inert body regardless of their own
    // connection, so their carrier keeps carrying them.
    this.#dropCarryFor(member.session, member.player);
    // Nor is anyone left sitting: a reconnect within the grace window comes back standing.
    standUp(member.session, member.player);
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

  /** Clears a carry in both directions. Safe to call on a player who is carrying nobody. */
  #dropCarryFor(session: Session, player: SessionPlayer): void {
    if (player.carryingPlayerId) {
      const carried = session.players.get(player.carryingPlayerId);
      if (carried) carried.carriedByPlayerId = null;
      player.carryingPlayerId = null;
    }
  }

  #removePlayer({ session, player }: SessionMember): void {
    // A removed player can neither keep carrying nor keep being carried: the slot they occupied is
    // about to disappear, so both sides of any carry link must be cleared before it does.
    this.#dropCarryFor(session, player);
    if (player.carriedByPlayerId) {
      const carrier = session.players.get(player.carriedByPlayerId);
      if (carrier) carrier.carryingPlayerId = null;
    }

    session.players.delete(player.id);
    this.#sessionByPlayer.delete(player.id);
  }
}

/**
 * The first party colour nobody in the session holds, or undefined when all of them are taken.
 * Counted from the slots that exist now, so a released slot's colour goes to the next arrival.
 */
function freePartyColor(session: Session): PartyColor | undefined {
  const taken = new Set([...session.players.values()].map((player) => player.partyColor));
  return PARTY_COLORS.find((color) => !taken.has(color));
}

/**
 * Public view of a player. Drops `resumeToken`, `disconnectedAt`, pacing timers, and the profile's
 * bank, none of which are broadcast. Resistance and stamina are rounded here: they move by fractions of a point per tick on
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
    held: player.held ? { ...player.held } : null,
    drawFraction: player.draw ? player.draw.fraction : null,
    carryingTorch: player.carryingTorch,
    carryingPlayerId: player.carryingPlayerId,
    carriedByPlayerId: player.carriedByPlayerId,
    seatId: player.seatId,
    readyPlateId: player.readyPlateId,
    appearance: player.appearance ? { ...player.appearance } : null,
    partyColor: player.partyColor,
  };
}

/** The player's own entry, the only one that carries their bank. Never broadcast. */
export function toOwnerPlayerState(player: SessionPlayer, session?: Session): PlayerState {
  return withOwnBank(toPlayerState(player, session), player);
}

export function withOwnBank(state: PlayerState, player: SessionPlayer): PlayerState {
  return { ...state, bankedItems: player.profile.bankedItems.map((item) => ({ ...item })) };
}

/**
 * Who is in the party, for members who cannot see each other. Only identity and connection: nothing
 * here may reveal where a member is or how they are, because the receiver may have lost sight of
 * them on purpose. Members still designing their character are left out until they have one.
 */
export function partyRosterOf(session: Session): PartyRosterEntry[] {
  return [...session.players.values()]
    .filter((player) => player.appearance !== null)
    .map((player) => ({
      playerId: player.id,
      name: player.name,
      partyColor: player.partyColor,
      connected: player.connected,
    }));
}

/** Public state for every player, without banks. Build once per tick and share across viewers. */
export function rosterOf(session: Session): PlayerState[] {
  return [...session.players.values()].map((player) => toPlayerState(player, session));
}
