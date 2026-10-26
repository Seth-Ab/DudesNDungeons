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
import { createRunStats, type RunStats } from "../game/milestones.js";
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
import {
  resolveAppearance,
  resolvePartyColor,
  restoreRun,
  restoreRunPlayer,
} from "../saves/roomSave.js";
import { RoomSaveStore } from "../saves/roomSaveStore.js";
import type { PartyVault } from "../vaults/partyVault.js";
import { VaultStore } from "../vaults/vaultStore.js";

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
  /** Stacks per skill from scrolls consumed this run, provisional until this player extracts. */
  runSkillStacks: Map<string, number>;
  /**
   * The run purse: coin carried this run, outside the inventory slots. Credited to the profile when
   * this player extracts and lost otherwise, like `runSkillStacks`.
   */
  runCoin: number;
  /** What this player did this run toward milestone stats; credited like `runCoin`. */
  runStats: RunStats;
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
  /**
   * Server clock time this player last took or dealt damage, or null if not this run. `saveAndQuit`
   * is refused for `SAVE_QUIT_COMBAT_GRACE_MS` after it. Set by `markCombat` in `vitals.ts`.
   */
  lastCombatAt: number | null;
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
  /**
   * The party vault for this room code, owned by `VaultStore` and shared by reference. Every member
   * sees and may take from it; escapes deposit into it.
   */
  vault: PartyVault;
  /**
   * The room saves, shared by reference like `vault`. A session only asks this to drop its room's
   * run (`returnToHub`); capturing one is the server's job, so a save is never a live reference.
   */
  saves: RoomSaveStore;
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
  /**
   * Answers a room whose save holds a run (decision 0015). Absent, a member of that run is refused
   * with `savedRunExists`; `continue` restores them into it; `discard` deletes the whole save first.
   */
  savedRun?: "continue" | "discard" | null;
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

export type SetNameResult =
  | { ok: true; member: SessionMember; previousName: PlayerName }
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
  /**
   * Where party vaults live. Defaults to an in-memory store, so a test writes nothing;
   * `src/server/index.ts` supplies the file-backed one.
   */
  vaults?: VaultStore;
  /** Where room saves live (decision 0015). In-memory by default, like `vaults`. */
  saves?: RoomSaveStore;
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
  /** Party vaults by room code. Public so the server can flush them when they change. */
  readonly vaults: VaultStore;
  /** Room saves by room code. Public for the same reason as `vaults`. */
  readonly saves: RoomSaveStore;
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
    this.vaults = options.vaults ?? new VaultStore();
    this.saves = options.saves ?? new RoomSaveStore();
  }

  /**
   * A new room with an empty vault. A code whose vault or room save is kept counts as taken even
   * with no live session, so a new room is never handed another party's vault or characters.
   */
  createSession(): Session {
    const taken = (code: RoomCode): boolean =>
      this.#sessions.has(code) || this.vaults.has(code) || this.saves.has(code);
    let roomCode = this.#createRoomCode();
    for (let attempt = 0; taken(roomCode); attempt += 1) {
      if (attempt >= 50) {
        throw new Error("Unable to allocate an unused room code");
      }
      roomCode = this.#createRoomCode();
    }

    return this.#openSession(roomCode);
  }

  /** Puts a session in the hub under this room code, with the room's vault. */
  #openSession(roomCode: RoomCode): Session {
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
      vault: this.vaults.open(roomCode),
      saves: this.saves,
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
    const live = this.#sessions.get(request.roomCode);
    let save = this.saves.get(request.roomCode);
    // A save nobody has played for a week is gone. A live session keeps its own characters, so only
    // a room with no session can lapse.
    if (live === undefined && save !== undefined && this.saves.isExpired(save)) {
      this.saves.delete(request.roomCode);
      save = undefined;
    }

    // A room whose session was swept, or lost to a restart, still owns its vault and its save.
    // Joining its code reopens it, which is what lets a party come back to what they stored.
    if (live === undefined && !this.vaults.has(request.roomCode) && save === undefined) {
      return { ok: false, code: "sessionNotFound", message: "No dungeon exists for that room code" };
    }

    if (request.resumeToken && live) {
      const existing = [...live.players.values()].find(
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
        return { ok: true, resumed: true, session: live, player: existing };
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

    // A live hub holds no run; one that still has a saved run is a leftover, so the run is dropped.
    if (live?.location === "hub" && live.players.size > 0 && save?.run) {
      this.saves.clearRun(request.roomCode);
      save = this.saves.get(request.roomCode);
    }

    let run = save?.run ?? null;
    let entry = run?.players.find((candidate) => candidate.profileId === request.profile?.id);

    if (run !== null) {
      // The run belongs to the profiles that played it. A join with no secret names none, and a
      // new player can't be added to a saved run, so neither may continue or discard it.
      if (entry === undefined) {
        return {
          ok: false,
          code: "notSaveMember",
          message: "This room has a saved run, and only the members who were in it can rejoin",
        };
      }
      if (request.savedRun == null) {
        return {
          ok: false,
          code: "savedRunExists",
          message: "This room has a saved run. Continue it, or discard it and start fresh",
        };
      }
    }

    let session = live;
    if (run !== null && request.savedRun === "discard") {
      if (live && [...live.players.values()].some((candidate) => candidate.connected)) {
        return {
          ok: false,
          code: "notPermitted",
          message: "Another member is playing this run, so its save can't be discarded",
        };
      }
      // Only slots held open for dropped players remain; the save they were holding goes with them.
      if (live) this.#closeSession(live);
      this.saves.delete(request.roomCode);
      session = undefined;
      save = undefined;
      run = null;
      entry = undefined;
    }

    if (session?.location === "dungeon" && run === null) {
      return {
        ok: false,
        code: "runInProgress",
        message: "This party is already in a dungeon run; wait for them to return to the hub",
      };
    }

    if (session && (session.players.size >= this.#maxPartySize || freePartyColor(session) === undefined)) {
      return { ok: false, code: "sessionFull", message: "This dungeon is full" };
    }

    session ??= this.#openSession(request.roomCode);
    if (run !== null && session.location !== "dungeon") restoreRun(session, run, this.#now());

    // A member skips the designer: their saved character is put back, and so is their party colour
    // when it is still free.
    const member = save?.members.find((candidate) => candidate.profileId === request.profile?.id);
    const savedColor = member === undefined ? null : resolvePartyColor(member.partyColor);
    const partyColor =
      savedColor !== null && !colorInUse(session, savedColor) ? savedColor : freePartyColor(session);
    if (partyColor === undefined) {
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
      runSkillStacks: new Map(),
      runCoin: 0,
      runStats: createRunStats(),
      carryingTorch: false,
      carryingPlayerId: null,
      carriedByPlayerId: null,
      seatId: null,
      readyPlateId: null,
      readyFromPlate: false,
      declinedPlateId: null,
      appearance: member === undefined ? null : resolveAppearance(member.appearance),
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
      lastCombatAt: null,
    };
    if (run !== null && entry !== undefined) {
      restoreRunPlayer(player, entry, session.dungeon.map, this.#now());
    }

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

  /**
   * Renames a player who is still designing. Same trim and length rule as the join name, which the
   * protocol schema already applied; what is left is uniqueness (ignoring case, among the others
   * in the room) and the designing-only rule.
   */
  setName(playerId: PlayerId, name: PlayerName): SetNameResult {
    const member = this.findMember(playerId);
    if (!member) {
      return { ok: false, code: "notInSession", message: "Join a dungeon before sending this message" };
    }
    if (member.player.appearance !== null) {
      return {
        ok: false,
        code: "nameLocked",
        message: "Your character is already designed and cannot be renamed",
      };
    }
    const wanted = name.toLowerCase();
    for (const other of member.session.players.values()) {
      if (other.id !== playerId && other.name.toLowerCase() === wanted) {
        return { ok: false, code: "nameTaken", message: "Another player here already uses that name" };
      }
    }

    const previousName = member.player.name;
    member.player.name = name;
    return { ok: true, member, previousName };
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

  /** Drops a session and every slot in it, which the caller has checked nobody is connected to. */
  #closeSession(session: Session): void {
    for (const player of [...session.players.values()]) this.#removePlayer({ session, player });
    this.#sessions.delete(session.roomCode);
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

function colorInUse(session: Session, color: PartyColor): boolean {
  return [...session.players.values()].some((player) => player.partyColor === color);
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
    drawRange: player.draw ? { ...player.draw.reach } : null,
    carryingTorch: player.carryingTorch,
    carryingPlayerId: player.carryingPlayerId,
    carriedByPlayerId: player.carriedByPlayerId,
    seatId: player.seatId,
    readyPlateId: player.readyPlateId,
    appearance: player.appearance ? { ...player.appearance } : null,
    partyColor: player.partyColor,
    cosmetics: { ...player.profile.equippedCosmetics },
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
 * them on purpose. A member still designing their character is listed with `designing` set, which
 * is all that is true of them yet.
 */
export function partyRosterOf(session: Session): PartyRosterEntry[] {
  return [...session.players.values()].map((player) => ({
    playerId: player.id,
    name: player.name,
    partyColor: player.partyColor,
    connected: player.connected,
    designing: player.appearance === null,
  }));
}

/** Public state for every player, without banks. Build once per tick and share across viewers. */
export function rosterOf(session: Session): PlayerState[] {
  return [...session.players.values()].map((player) => toPlayerState(player, session));
}
