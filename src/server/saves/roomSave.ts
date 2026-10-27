import { z } from "zod";
import {
  BODY_TYPES,
  HAIR_COLORS,
  HAIR_STYLES,
  PARTY_COLORS,
  SKIN_TONES,
} from "../../shared/constants/appearance.js";
import { PROTOCOL_VERSION } from "../../shared/constants/game.js";
import {
  dungeonStateSchema,
  entityIdSchema,
  inventoryItemSchema,
  playerNameSchema,
  profileIdSchema,
  roomCodeSchema,
  vector2Schema,
  type DungeonMapState,
  type PartyColor,
  type PlayerAppearance,
  type ProfileId,
} from "../../shared/types/core.js";
import { DEFAULT_DUNGEON_ID } from "../game/dungeonState.js";
import { createRng } from "../game/random.js";
import { createDiscoveredGrid } from "../game/tileGrid.js";
import { timeInDungeon } from "../game/vitals.js";
import type { Session, SessionPlayer } from "../sessions/sessionStore.js";

/**
 * A room save (decision 0015): what a room code keeps between visits beyond its vault. It outlives
 * runs. `members` are the party's characters for the life of the room; `run` is the run in
 * progress, present only while there is one, and cleared by an escape or a wipe.
 *
 * Everything time-based is stored as a duration, not a clock reading, so a run saved on Monday and
 * continued on Wednesday resumes with the time it had left: the run clock, trap re-arms, puzzle
 * holds and flares all pause while saved.
 */

/** A save last played longer ago than this is deleted when the server loads it. */
export const ROOM_SAVE_TTL_MS = 7 * 24 * 60 * 60_000;

export const ROOM_SAVE_FILE_VERSION = 1;

/**
 * A member's look, kept loose on purpose: an appearance id later removed from content must load and
 * fall back (#135) rather than make the whole file unreadable, so the shared id lists are checked
 * when the look is put back on a player, not here.
 */
const persistedAppearanceSchema = z.object({
  body: z.string().min(1),
  skinTone: z.string().min(1),
  hairStyle: z.string().min(1),
  hairColor: z.string().min(1),
});

export const persistedMemberSchema = z.object({
  profileId: profileIdSchema,
  name: playerNameSchema,
  appearance: persistedAppearanceSchema,
  partyColor: z.string().min(1),
});
export type PersistedMember = z.infer<typeof persistedMemberSchema>;

/**
 * A member's look as the shared lists have it today. Each field that names an id since removed from
 * its list falls back to that list's first entry, so one retired hair style costs a member that
 * field and not the character (#135).
 */
export function resolveAppearance(saved: PersistedMember["appearance"]): PlayerAppearance {
  return {
    body: pickId(BODY_TYPES, saved.body),
    skinTone: pickId(SKIN_TONES, saved.skinTone),
    hairStyle: pickId(HAIR_STYLES, saved.hairStyle),
    hairColor: pickId(HAIR_COLORS, saved.hairColor),
  };
}

/** A member's party colour, or null when it has since left the list, so the caller assigns a free one. */
export function resolvePartyColor(saved: string): PartyColor | null {
  return (PARTY_COLORS as readonly string[]).includes(saved) ? (saved as PartyColor) : null;
}

function pickId<T extends string>(list: readonly T[], saved: string): T {
  return (list as readonly string[]).includes(saved) ? (saved as T) : list[0]!;
}

const durationSchema = z.number().nonnegative();
const durationsByIdSchema = z.record(entityIdSchema, durationSchema);

const persistedRunStatsSchema = z.object({
  leverPuzzlesSolved: z.number().int().nonnegative(),
  emberWardenKills: z.number().int().nonnegative(),
  flawlessEmberWardenKills: z.number().int().nonnegative(),
  mothRoomFound: z.boolean(),
  carriedTorch: z.boolean(),
  downed: z.boolean(),
});

/** One member's place in the run. Keyed by profile, because resume tokens do not survive a restart. */
export const persistedRunPlayerSchema = z.object({
  profileId: profileIdSchema,
  position: vector2Schema,
  facing: vector2Schema,
  health: z.number().nonnegative(),
  resistance: z.number().nonnegative(),
  stamina: z.number().nonnegative(),
  inventory: z.array(inventoryItemSchema),
  held: inventoryItemSchema.nullable(),
  carryingTorch: z.boolean(),
  torchLit: z.boolean().default(true),
  runSkillStacks: z.record(z.string().min(1), z.number().int().positive()),
  runCoin: z.number().int().nonnegative(),
  runStats: persistedRunStatsSchema,
  /** `discoveredTiles` packed one bit per tile and base64-encoded. */
  discoveredTiles: z.string(),
  discoveredTileCount: z.number().int().nonnegative(),
  discoveredRoomIds: z.array(z.string().min(1)),
  /** How long this player had been in the dungeon when saved: the run clock, paused. */
  runElapsedMs: durationSchema,
});
export type PersistedRunPlayer = z.infer<typeof persistedRunPlayerSchema>;

const persistedMonsterPostSchema = z.object({
  spawn: vector2Schema,
  engaged: z.boolean(),
  /** How long before the save a player was last inside its aggro range. */
  lastThreatAgoMs: durationSchema,
});

export const persistedRunSchema = z.object({
  savedAt: z.number().nonnegative(),
  /** Content and protocol the run was played under; a save from any other is discarded on load. */
  contentVersion: z.string().min(1),
  protocolVersion: z.number().int().nonnegative(),
  tick: z.number().int().nonnegative(),
  seed: z.number().int().nullable(),
  /**
   * Content id of the dungeon, for the lobby's Continue list. Optional so runs saved before it was
   * recorded still load; their card simply has no dungeon name.
   */
  dungeonId: z.string().min(1).optional(),
  /** The whole server-side world, projectiles excepted: they are dropped on save. */
  dungeon: dungeonStateSchema,
  spawnPoints: z.array(vector2Schema).min(1),
  lootRngState: z.number().int().nonnegative(),
  monsterCooldownsInMs: durationsByIdSchema,
  monsterPosts: z.record(entityIdSchema, persistedMonsterPostSchema),
  trapRearmInMs: durationsByIdSchema,
  puzzleHeldForMs: durationsByIdSchema,
  flareExpiresInMs: durationsByIdSchema,
  /** Camps that have rested the party. Optional so runs saved before camps rested still load. */
  campsRested: z.array(entityIdSchema).default([]),
  /** Ids of the omens the run rolled, which still change its rules. Optional for older saves. */
  omens: z.array(z.string()).default([]),
  players: z.array(persistedRunPlayerSchema),
});
export type PersistedRun = z.infer<typeof persistedRunSchema>;

export const roomSaveSchema = z.object({
  roomCode: roomCodeSchema,
  lastPlayedAt: z.number().nonnegative(),
  members: z.array(persistedMemberSchema),
  run: persistedRunSchema.nullable(),
});
export type RoomSave = z.infer<typeof roomSaveSchema>;

export const roomSaveFileSchema = z.object({
  version: z.literal(ROOM_SAVE_FILE_VERSION),
  rooms: z.array(roomSaveSchema),
});
export type RoomSaveFile = z.infer<typeof roomSaveFileSchema>;

/** A room whose run no longer parses keeps its members: losing the run must not cost the party. */
const roomSaveHeaderSchema = roomSaveSchema.extend({ run: z.unknown() });

const roomSaveEnvelopeSchema = z.object({
  version: z.number().int().nonnegative(),
  rooms: z.array(z.unknown()),
});

/**
 * Validates a file's contents, one room at a time.
 *
 * Saves are disposable in a way profiles and vaults are not, so a file from an older format is
 * discarded rather than stopping the server, and one room that no longer parses loses only its run
 * (or, if even its members are unreadable, only itself). A file from a newer format, or one that is
 * not a save file at all, still throws: overwriting it would destroy what a newer server wrote.
 */
export function parseRoomSaveFile(payload: unknown, label: string): RoomSaveFile | null {
  const envelope = roomSaveEnvelopeSchema.safeParse(payload);
  if (!envelope.success) throw new Error(`${label} is not a valid room save file`);

  const { version } = envelope.data;
  if (version > ROOM_SAVE_FILE_VERSION) {
    throw new Error(`${label} is room save version ${version}, newer than this server's ${ROOM_SAVE_FILE_VERSION}`);
  }
  if (version < ROOM_SAVE_FILE_VERSION) {
    console.warn(`[saves] ${label} is room save version ${version}; discarding its saves`);
    return null;
  }

  const rooms: RoomSave[] = [];
  for (const raw of envelope.data.rooms) {
    const full = roomSaveSchema.safeParse(raw);
    if (full.success) {
      rooms.push(full.data);
      continue;
    }

    const header = roomSaveHeaderSchema.safeParse(raw);
    if (header.success) {
      console.warn(`[saves] ${label}: room ${header.data.roomCode}'s run is unreadable; keeping its members`);
      rooms.push({ ...header.data, run: null });
    } else {
      console.warn(`[saves] ${label}: dropping an unreadable room save`);
    }
  }

  return { version: ROOM_SAVE_FILE_VERSION, rooms };
}

/** True when a run was saved under the content and protocol this server is running. */
export function runIsCurrent(run: PersistedRun, currentContentVersion: string): boolean {
  return run.contentVersion === currentContentVersion && run.protocolVersion === PROTOCOL_VERSION;
}

/**
 * The party's characters as they stand: every player in the session with a look, plus anyone in
 * `previous` who is not playing right now. A member who saved and quit stays a member.
 */
export function captureMembers(session: Session, previous: readonly PersistedMember[] = []): PersistedMember[] {
  const members: PersistedMember[] = [];
  const present = new Set<ProfileId>();

  for (const player of session.players.values()) {
    if (player.appearance === null) continue;
    present.add(player.profile.id);
    members.push({
      profileId: player.profile.id,
      name: player.name,
      appearance: { ...player.appearance },
      partyColor: player.partyColor,
    });
  }

  for (const member of previous) {
    if (!present.has(member.profileId)) members.push(structuredClone(member));
  }
  return members;
}

/**
 * The run in progress, as of `now`. Players in `previous` who are not in the session (members who
 * saved and quit) are carried over untouched, so an autosave never drops them.
 *
 * Projectiles, wind-ups, charges and bow draws are not saved: decision 0015 resets attacks in flight
 * on load. Carry links, seats and plates are not saved either; a carried player is set down.
 */
export function captureRun(
  session: Session,
  now: number,
  currentContentVersion: string,
  previous: PersistedRun | null = null,
): PersistedRun {
  if (session.location !== "dungeon") throw new Error(`Room ${session.roomCode} has no run to save`);

  const players = [...session.players.values()].map((player) => captureRunPlayer(player, now));
  const present = new Set(players.map((player) => player.profileId));
  for (const entry of previous?.players ?? []) {
    if (!present.has(entry.profileId)) players.push(structuredClone(entry));
  }

  return {
    savedAt: now,
    contentVersion: currentContentVersion,
    protocolVersion: PROTOCOL_VERSION,
    tick: session.tick,
    seed: session.seed,
    dungeonId: session.runDungeon.dungeonId ?? DEFAULT_DUNGEON_ID,
    dungeon: { ...structuredClone(session.dungeon), projectiles: [] },
    spawnPoints: structuredClone(session.spawnPoints),
    lootRngState: session.lootRng.state(),
    monsterCooldownsInMs: remaining(session.monsterCooldowns, now),
    monsterPosts: Object.fromEntries(
      [...session.monsterPosts].map(([id, post]) => [
        id,
        { spawn: { ...post.spawn }, engaged: post.engaged, lastThreatAgoMs: Math.max(0, now - post.lastThreatAt) },
      ]),
    ),
    trapRearmInMs: remaining(session.trapRearmAt, now),
    puzzleHeldForMs: Object.fromEntries(
      [...session.puzzleHeldSince].map(([id, since]) => [id, Math.max(0, now - since)]),
    ),
    flareExpiresInMs: remaining(session.flareExpiresAt, now),
    campsRested: [...session.campsRested],
    omens: [...session.runOmens],
    players,
  };
}

function captureRunPlayer(player: SessionPlayer, now: number): PersistedRunPlayer {
  return {
    profileId: player.profile.id,
    position: { ...player.position },
    facing: { ...player.facing },
    health: player.health,
    resistance: player.resistance,
    stamina: player.stamina,
    inventory: structuredClone(player.inventory),
    held: player.held === null ? null : structuredClone(player.held),
    carryingTorch: player.carryingTorch,
    torchLit: player.torchLit,
    runSkillStacks: Object.fromEntries(player.runSkillStacks),
    runCoin: player.runCoin,
    runStats: { ...player.runStats },
    discoveredTiles: packTiles(player.discoveredTiles),
    discoveredTileCount: player.discoveredTiles.length,
    discoveredRoomIds: [...player.discoveredRoomIds],
    runElapsedMs: timeInDungeon(player, now),
  };
}

/**
 * Puts a saved run's world back on `session` as of `now`, leaving its players alone; each member is
 * restored with `restoreRunPlayer` as they rejoin. Timers resume with the time they had left, and
 * every attack that was mid-swing or in flight is gone.
 */
export function restoreRun(session: Session, run: PersistedRun, now: number): void {
  const dungeon = structuredClone(run.dungeon);
  dungeon.projectiles = [];
  for (const monster of dungeon.monsters) {
    if (monster.action !== "idle") {
      monster.action = "idle";
      monster.windupProgress = 0;
    }
  }

  session.dungeon = dungeon;
  session.location = "dungeon";
  session.spawnPoints = structuredClone(run.spawnPoints);
  session.seed = run.seed;
  session.runOmens = [...run.omens];
  session.lootRng = createRng(run.lootRngState);
  session.tick = run.tick;
  session.simulatedAt = null;
  session.monsterCooldowns = due(run.monsterCooldownsInMs, now);
  session.monsterWindups = new Map();
  session.monsterCharges = new Map();
  session.projectileRuns = new Map();
  session.monsterPosts = new Map(
    Object.entries(run.monsterPosts).map(([id, post]) => [
      id,
      { spawn: { ...post.spawn }, engaged: post.engaged, lastThreatAt: now - post.lastThreatAgoMs },
    ]),
  );
  session.trapRearmAt = due(run.trapRearmInMs, now);
  session.puzzleHeldSince = new Map(Object.entries(run.puzzleHeldForMs).map(([id, heldFor]) => [id, now - heldFor]));
  session.flareExpiresAt = due(run.flareExpiresInMs, now);
  // A turned keyhole lasts a second, so it is not saved: every twin lock loads with both unturned.
  session.twinLockTurns = new Map();
  for (const chest of session.dungeon.chests) chest.keyTurnedBy = null;
  // Seats are not saved, so everyone stands on load and a camp's countdown starts over.
  session.campSeatedSince = new Map();
  session.campsRested = new Set(run.campsRested);
  session.dummyHits = new Map();
}

/**
 * Puts one member's saved run state back on their player, as of `now`. Who they are (name, look,
 * profile, connection, resume token) is the caller's; this restores only where they were and what
 * they had, and clears everything transient: carry links, seats, plates, ready, draws and cooldowns.
 */
export function restoreRunPlayer(
  player: SessionPlayer,
  entry: PersistedRunPlayer,
  map: DungeonMapState,
  now: number,
): void {
  player.position = { ...entry.position };
  player.facing = { ...entry.facing };
  player.health = entry.health;
  player.resistance = entry.resistance;
  player.stamina = entry.stamina;
  player.inventory = structuredClone(entry.inventory);
  player.held = entry.held === null ? null : structuredClone(entry.held);
  player.carryingTorch = entry.carryingTorch;
  player.torchLit = entry.torchLit;
  player.runSkillStacks = new Map(Object.entries(entry.runSkillStacks));
  player.runCoin = entry.runCoin;
  player.runStats = { ...entry.runStats };
  player.enteredDungeonAt = now - entry.runElapsedMs;

  const tileCount = map.width * map.height;
  player.discoveredTiles =
    entry.discoveredTileCount === tileCount
      ? unpackTiles(entry.discoveredTiles, tileCount)
      : createDiscoveredGrid(map.width, map.height);
  player.discoveredRoomIds = new Set(entry.discoveredRoomIds);
  player.discoveryLog = discoveredIndexes(player.discoveredTiles);
  player.pendingDiscovery = [];
  player.mapSyncedTo = null;

  player.ready = false;
  player.draw = null;
  player.carryingPlayerId = null;
  player.carriedByPlayerId = null;
  player.seatId = null;
  player.readyPlateId = null;
  player.readyFromPlate = false;
  player.declinedPlateId = null;
  player.nextMoveAt = null;
  player.nextAttackAt = null;
  player.lastCombatAt = null;
}

function remaining(times: ReadonlyMap<string, number>, now: number): Record<string, number> {
  return Object.fromEntries([...times].map(([id, at]) => [id, Math.max(0, at - now)]));
}

function due(durations: Readonly<Record<string, number>>, now: number): Map<string, number> {
  return new Map(Object.entries(durations).map(([id, inMs]) => [id, now + inMs]));
}

/** One bit per tile, so a scaled map's memory is a few kilobytes rather than one byte a tile. */
export function packTiles(tiles: Uint8Array): string {
  const bits = new Uint8Array(Math.ceil(tiles.length / 8));
  for (let index = 0; index < tiles.length; index += 1) {
    if (tiles[index] !== 0) bits[index >> 3]! |= 1 << (index & 7);
  }
  return Buffer.from(bits).toString("base64");
}

export function unpackTiles(packed: string, count: number): Uint8Array {
  const bits = Buffer.from(packed, "base64");
  const tiles = new Uint8Array(count);
  for (let index = 0; index < count; index += 1) {
    if (((bits[index >> 3] ?? 0) >> (index & 7)) & 1) tiles[index] = 1;
  }
  return tiles;
}

function discoveredIndexes(tiles: Uint8Array): number[] {
  const indexes: number[] = [];
  for (let index = 0; index < tiles.length; index += 1) {
    if (tiles[index] !== 0) indexes.push(index);
  }
  return indexes;
}
