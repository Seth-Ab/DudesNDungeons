import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { contentVersion } from "../../src/server/content/contentVersion.js";
import { loadContent } from "../../src/server/content/loadContent.js";
import { createRng } from "../../src/server/game/random.js";
import { startRun } from "../../src/server/game/runLifecycle.js";
import { DEFAULT_APPEARANCE } from "../../src/shared/constants/appearance.js";
import { timeInDungeon } from "../../src/server/game/vitals.js";
import { createFileRoomSaveStorage } from "../../src/server/saves/fileRoomSaveStorage.js";
import {
  captureMembers,
  captureRun,
  packTiles,
  persistedRunSchema,
  restoreRun,
  restoreRunPlayer,
  ROOM_SAVE_TTL_MS,
  unpackTiles,
  type PersistedRun,
  type RoomSave,
} from "../../src/server/saves/roomSave.js";
import {
  createMemoryRoomSaveStorage,
  RoomSaveStore,
  type RoomSaveStorage,
} from "../../src/server/saves/roomSaveStore.js";
import { SessionStore, type Session, type SessionPlayer } from "../../src/server/sessions/sessionStore.js";
import { PROTOCOL_VERSION } from "../../src/shared/constants/game.js";
import type { InventoryItem } from "../../src/shared/types/core.js";
import { at, TEST_SEED, testPlayer, testProfile, testSession, TONIC_FIELDS } from "./fixtures.js";

const ROOM = "BCDFGH";
const VERSION = "content-a";

const GRIX_PROFILE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const MOSS_PROFILE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ABSENT_PROFILE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const TRAP = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const PUZZLE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const FLARE = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const PROJECTILE = "12121212-1212-4121-8121-121212121212";

const TONIC: InventoryItem = { id: "11111111-1111-4111-8111-111111111111", name: "Minor Tonic", ...TONIC_FIELDS };

function member(name: string, profileId: string, overrides: Partial<SessionPlayer> = {}): SessionPlayer {
  return testPlayer(name, { profile: testProfile(name, { id: profileId }), ...overrides });
}

/** A run five seconds in, with something on every timer a save has to carry. */
function runInProgress(): Session {
  const grix = member("Grix", GRIX_PROFILE, {
    position: at(3, 2),
    health: 61,
    resistance: 7.25,
    stamina: 40.5,
    inventory: [{ ...TONIC }],
    runCoin: 12,
    enteredDungeonAt: 1_000,
  });
  grix.runSkillStacks.set("iron-will", 2);
  grix.runStats.leverPuzzlesSolved = 1;
  const moss = member("Moss", MOSS_PROFILE, { enteredDungeonAt: 2_000, partyColor: "moss" });

  const session = testSession([grix, moss]);
  session.tick = 340;
  const [first] = session.dungeon.monsters;
  if (!first) throw new Error("The test dungeon has no monsters");
  session.monsterCooldowns.set(first.id, 6_500);
  session.monsterPosts.set(first.id, { spawn: { ...first.position }, engaged: true, lastThreatAt: 4_000 });
  session.trapRearmAt.set(TRAP, 8_000);
  session.puzzleHeldSince.set(PUZZLE, 4_500);
  session.flareExpiresAt.set(FLARE, 20_000);

  // Discover a scattering of tiles, the way visibility would.
  const { width, height } = session.dungeon.map;
  for (const player of [grix, moss]) {
    player.discoveredTiles = new Uint8Array(width * height);
    for (let index = 0; index < player.discoveredTiles.length; index += 7) player.discoveredTiles[index] = 1;
    player.discoveredRoomIds = new Set(session.dungeon.rooms.slice(0, 2).map((room) => room.id));
  }
  return session;
}

/** A fresh world and fresh players, as a restart would leave them, with the save put back on. */
function restored(run: PersistedRun, now: number): Session {
  const session = testSession([
    member("Grix", GRIX_PROFILE, { enteredDungeonAt: null }),
    member("Moss", MOSS_PROFILE, { enteredDungeonAt: null, partyColor: "moss" }),
  ]);
  restoreRun(session, run, now);
  for (const player of session.players.values()) {
    const entry = run.players.find((candidate) => candidate.profileId === player.profile.id);
    if (entry) restoreRunPlayer(player, entry, session.dungeon.map, now);
  }
  return session;
}

function roomSave(overrides: Partial<RoomSave> = {}): RoomSave {
  const session = runInProgress();
  return {
    roomCode: ROOM,
    lastPlayedAt: 5_000,
    members: captureMembers(session),
    run: captureRun(session, 5_000, VERSION),
    ...overrides,
  };
}

const temporaryRoots: string[] = [];

function temporaryFile(): string {
  const root = mkdtempSync(join(tmpdir(), "dnd-rooms-"));
  temporaryRoots.push(root);
  return join(root, "rooms.json");
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("saving and restoring a run", () => {
  it("restores an equal world and members, with every timer rebuilt from the load time", () => {
    const run = captureRun(runInProgress(), 5_000, VERSION);
    const session = restored(run, 1_000_000);

    // Saving again at the moment of restore gives back the same save: nothing was lost or shifted.
    expect(captureRun(session, 1_000_000, VERSION)).toEqual({ ...run, savedAt: 1_000_000 });

    const [first] = session.dungeon.monsters;
    expect(session.monsterCooldowns.get(first!.id)).toBe(1_001_500);
    expect(session.monsterPosts.get(first!.id)?.lastThreatAt).toBe(999_000);
    expect(session.puzzleHeldSince.get(PUZZLE)).toBe(999_500);
    expect(session.flareExpiresAt.get(FLARE)).toBe(1_015_000);

    const grix = [...session.players.values()].find((player) => player.name === "Grix")!;
    expect(grix.position).toEqual(at(3, 2));
    expect(grix).toMatchObject({ health: 61, resistance: 7.25, stamina: 40.5, runCoin: 12 });
    expect(grix.inventory).toEqual([TONIC]);
    expect(grix.runSkillStacks).toEqual(new Map([["iron-will", 2]]));
    expect(grix.runStats.leverPuzzlesSolved).toBe(1);
    expect(grix.discoveryLog.length).toBeGreaterThan(0);
    expect(grix.discoveryLog.every((index) => grix.discoveredTiles[index] === 1)).toBe(true);
    expect(grix.mapSyncedTo).toBeNull();
  });

  it("pauses the run clock and trap timers while saved", () => {
    const original = runInProgress();
    const grixBefore = [...original.players.values()].find((player) => player.name === "Grix")!;
    expect(timeInDungeon(grixBefore, 5_000)).toBe(4_000);

    const session = restored(captureRun(original, 5_000, VERSION), 9_000_000);
    const grix = [...session.players.values()].find((player) => player.name === "Grix")!;
    expect(timeInDungeon(grix, 9_000_000)).toBe(4_000);
    expect(session.trapRearmAt.get(TRAP)).toBe(9_003_000);
    expect(session.simulatedAt).toBeNull();
  });

  it("drops projectiles, wind-ups, charges, draws and carry links", () => {
    const session = runInProgress();
    const [first, second] = session.dungeon.monsters;
    first!.action = "windingUp";
    first!.windupProgress = 0.6;
    session.monsterWindups.set(first!.id, 4_800);
    if (second) {
      second.action = "charging";
      session.monsterCharges.set(second.id, { travelled: 3, stunnedUntil: null });
    }
    session.dungeon.projectiles.push({ id: PROJECTILE, position: at(4, 4), direction: { x: 1, y: 0 }, radius: 0.2 });
    session.projectileRuns.set(PROJECTILE, { ownerId: first!.id, damage: 5, speed: 6, remaining: 4 });
    const [grix, moss] = [...session.players.values()];
    grix!.draw = { heldId: TONIC.id, startedAt: 4_000, fraction: 0.5, reach: { minRange: 4, maxRange: 14 } };
    grix!.carryingPlayerId = moss!.id;
    moss!.carriedByPlayerId = grix!.id;
    moss!.health = 0;

    const run = captureRun(session, 5_000, VERSION);
    expect(run.dungeon.projectiles).toEqual([]);

    const back = restored(run, 6_000);
    expect(back.dungeon.projectiles).toEqual([]);
    expect(back.monsterWindups.size + back.monsterCharges.size + back.projectileRuns.size).toBe(0);
    expect(back.dungeon.monsters.every((monster) => monster.action === "idle")).toBe(true);
    expect(back.dungeon.monsters.find((monster) => monster.id === first!.id)?.windupProgress).toBe(0);
    for (const player of back.players.values()) {
      expect(player).toMatchObject({ draw: null, carryingPlayerId: null, carriedByPlayerId: null, ready: false });
    }
    // A save does not revive anyone: the downed player is set down, still downed.
    expect([...back.players.values()].find((player) => player.name === "Moss")?.health).toBe(0);
  });

  it("keeps a member who saved and quit across later saves", () => {
    const first = captureRun(runInProgress(), 5_000, VERSION);
    const absentEntry = { ...first.players[0]!, profileId: ABSENT_PROFILE, runCoin: 99 };
    const previous = { ...first, players: [...first.players, absentEntry] };

    const next = captureRun(runInProgress(), 50_000, VERSION, previous);
    expect(next.players.map((player) => player.profileId)).toEqual([GRIX_PROFILE, MOSS_PROFILE, ABSENT_PROFILE]);
    expect(next.players[2]).toEqual(absentEntry);

    const session = runInProgress();
    const members = captureMembers(session, [
      { profileId: ABSENT_PROFILE, name: "Absent", appearance: { ...session.players.values().next().value!.appearance! }, partyColor: "sky" },
    ]);
    expect(members.map((entry) => entry.profileId)).toEqual([GRIX_PROFILE, MOSS_PROFILE, ABSENT_PROFILE]);
  });

  it("validates a generated run without losing anything the server keeps", () => {
    const store = new SessionStore({ dungeon: { seed: TEST_SEED }, createRoomCode: () => ROOM });
    const session = store.createSession();
    for (const [index, name] of ["Grix", "Moss"].entries()) {
      const profileId = [GRIX_PROFILE, MOSS_PROFILE][index]!;
      const joined = store.join({ roomCode: ROOM, playerName: name, profile: testProfile(name, { id: profileId }), createProfile: () => testProfile(name) });
      if (!joined.ok) throw new Error(joined.message);
      store.setAppearance(joined.player.id, DEFAULT_APPEARANCE);
      joined.player.ready = true;
    }
    expect(startRun(session, 1_000)).toEqual({ ok: true });

    const run = captureRun(session, 2_000, VERSION);
    expect(persistedRunSchema.parse(JSON.parse(JSON.stringify(run)))).toEqual(run);
  });

  it("refuses to save a room that is not in a run", () => {
    const session = runInProgress();
    session.location = "hub";
    expect(() => captureRun(session, 5_000, VERSION)).toThrow(/no run/);
  });
});

describe("the loot stream", () => {
  it("continues the same sequence from its saved state", () => {
    const rng = createRng(20261021);
    for (let index = 0; index < 5; index += 1) rng.next();
    const copy = createRng(rng.state());
    expect(Array.from({ length: 10 }, () => copy.next())).toEqual(Array.from({ length: 10 }, () => rng.next()));
  });

  it("rolls the same drops after a restore as it would have without one", () => {
    const original = runInProgress();
    original.lootRng.next();
    const run = captureRun(original, 5_000, VERSION);
    const session = restored(run, 6_000);
    expect(Array.from({ length: 6 }, () => session.lootRng.int(0, 1000))).toEqual(
      Array.from({ length: 6 }, () => original.lootRng.int(0, 1000)),
    );
  });

  it("leaves a seeded stream unchanged", () => {
    // Pinned values: adding `state()` must not move the sequence every seeded dungeon depends on.
    const rng = createRng(1);
    expect([rng.next(), rng.next(), rng.next()]).toEqual([
      0.6270739405881613, 0.002735721180215478, 0.5274470399599522,
    ]);
  });
});

describe("the content version", () => {
  it("is the same for the same content however it was loaded, and changes with any definition", () => {
    const first = loadContent();
    const second = loadContent();
    expect(contentVersion(second)).toBe(contentVersion(first));

    const [id, item] = [...second.items.entries()][0]!;
    const edited = { ...second, items: new Map(second.items).set(id, { ...item, name: `${item.name}!` }) };
    expect(contentVersion(edited)).not.toBe(contentVersion(first));
  });
});

describe("tile packing", () => {
  it("round-trips any pattern, including a length that is not a whole byte", () => {
    const tiles = new Uint8Array(1_003);
    for (let index = 0; index < tiles.length; index += 1) tiles[index] = index % 3 === 0 || index === 1_002 ? 1 : 0;
    expect(unpackTiles(packTiles(tiles), tiles.length)).toEqual(tiles);
  });
});

describe("the room save store", () => {
  it("round-trips a hub save, with members and no run, through storage", () => {
    const storage = createMemoryRoomSaveStorage();
    const before = new RoomSaveStore(storage, { now: () => 5_000, contentVersion: VERSION });
    before.put(roomSave({ run: null }));
    before.flush();

    const after = new RoomSaveStore(storage, { now: () => 6_000, contentVersion: VERSION });
    expect(after.get(ROOM)).toEqual(roomSave({ run: null }));
    expect(after.dirty).toBe(false);
  });

  it("round-trips a save with a run in progress, validated on write", () => {
    const storage = createMemoryRoomSaveStorage();
    const before = new RoomSaveStore(storage, { now: () => 5_000, contentVersion: VERSION });
    const save = roomSave();
    before.put(save);
    before.flush();

    const after = new RoomSaveStore(storage, { now: () => 6_000, contentVersion: VERSION });
    expect(after.get(ROOM)).toEqual(save);
  });

  it("hands out copies, so changing one changes nothing stored", () => {
    const store = new RoomSaveStore(undefined, { contentVersion: VERSION });
    store.put(roomSave());
    store.get(ROOM)!.members.length = 0;
    expect(store.get(ROOM)!.members).toHaveLength(2);
  });

  it("deletes a save last played more than seven days ago, and the file forgets it too", () => {
    const storage = createMemoryRoomSaveStorage();
    const before = new RoomSaveStore(storage, { now: () => 0, contentVersion: VERSION });
    before.put(roomSave({ lastPlayedAt: 0 }));
    before.put(roomSave({ roomCode: "JKLMNP", lastPlayedAt: 1_000 }));
    before.flush();

    const after = new RoomSaveStore(storage, { now: () => ROOM_SAVE_TTL_MS + 500, contentVersion: VERSION });
    expect(after.has(ROOM)).toBe(false);
    expect(after.has("JKLMNP")).toBe(true);
    expect(after.dirty).toBe(true);
    after.flush();
    expect(storage.read()?.rooms.map((save) => save.roomCode)).toEqual(["JKLMNP"]);
  });

  it("clears the run of a save made under other content, keeping its members", () => {
    const storage = createMemoryRoomSaveStorage();
    const before = new RoomSaveStore(storage, { now: () => 5_000, contentVersion: VERSION });
    before.put(roomSave());
    before.flush();

    const after = new RoomSaveStore(storage, { now: () => 6_000, contentVersion: "content-b" });
    expect(after.get(ROOM)?.run).toBeNull();
    expect(after.get(ROOM)?.members.map((entry) => entry.profileId)).toEqual([GRIX_PROFILE, MOSS_PROFILE]);
  });

  it("clears the run of a save made under another protocol", () => {
    const storage = createMemoryRoomSaveStorage();
    const save = roomSave();
    storage.write({ version: 1, rooms: [{ ...save, run: { ...save.run!, protocolVersion: PROTOCOL_VERSION - 1 } }] });

    const store = new RoomSaveStore(storage, { now: () => 6_000, contentVersion: VERSION });
    expect(store.get(ROOM)?.run).toBeNull();
  });

  it("clears a run while keeping the members, and deletes both", () => {
    const store = new RoomSaveStore(undefined, { contentVersion: VERSION });
    store.put(roomSave());
    store.clearRun(ROOM);
    expect(store.get(ROOM)?.run).toBeNull();
    expect(store.get(ROOM)?.members).toHaveLength(2);

    store.delete(ROOM);
    expect(store.has(ROOM)).toBe(false);
  });

  it("writes nothing when nothing changed", () => {
    const inner = createMemoryRoomSaveStorage();
    const write = vi.fn(inner.write);
    const storage: RoomSaveStorage = { read: inner.read, write };
    const store = new RoomSaveStore(storage, { contentVersion: VERSION });

    store.flush();
    store.clearRun(ROOM);
    store.flush();
    expect(write).not.toHaveBeenCalled();

    store.put(roomSave());
    store.flush();
    store.flush();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("keeps a room code with a save out of new rooms", () => {
    const saves = new RoomSaveStore(undefined, { contentVersion: VERSION });
    saves.put(roomSave({ run: null }));
    const codes = [ROOM, "JKLMNP"];
    const store = new SessionStore({ saves, createRoomCode: () => codes.shift() ?? "QRSTVW" });
    expect(store.createSession().roomCode).toBe("JKLMNP");
  });
});

describe("the room save file", () => {
  it("writes atomically and reads back what it wrote", () => {
    const path = temporaryFile();
    const before = new RoomSaveStore(createFileRoomSaveStorage(path), { now: () => 5_000, contentVersion: VERSION });
    before.put(roomSave());
    before.flush();

    expect(existsSync(path)).toBe(true);
    expect(existsSync(`${path}.tmp`)).toBe(false);
    const after = new RoomSaveStore(createFileRoomSaveStorage(path), { now: () => 6_000, contentVersion: VERSION });
    expect(after.get(ROOM)).toEqual(roomSave());
  });

  it("starts empty when there is no file", () => {
    const store = new RoomSaveStore(createFileRoomSaveStorage(temporaryFile()), { contentVersion: VERSION });
    expect(store.size).toBe(0);
  });

  it("fails loudly on a file that is not JSON", () => {
    const path = temporaryFile();
    writeFileSync(path, "{ not json", "utf8");
    expect(() => new RoomSaveStore(createFileRoomSaveStorage(path), { contentVersion: VERSION })).toThrow(/not valid JSON/);
  });

  it("fails loudly on a file from a newer format, and leaves it alone", () => {
    const path = temporaryFile();
    writeFileSync(path, JSON.stringify({ version: 2, rooms: [] }), "utf8");
    expect(() => new RoomSaveStore(createFileRoomSaveStorage(path), { contentVersion: VERSION })).toThrow(/newer/);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ version: 2, rooms: [] });
  });

  it("discards a file from an older format", () => {
    const path = temporaryFile();
    writeFileSync(path, JSON.stringify({ version: 0, rooms: [{ roomCode: ROOM }] }), "utf8");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const store = new RoomSaveStore(createFileRoomSaveStorage(path), { contentVersion: VERSION });
    expect(store.size).toBe(0);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("version 0"));
  });

  it("keeps the members of a room whose run no longer parses, and drops a room that is unreadable", () => {
    const path = temporaryFile();
    const save = roomSave();
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        rooms: [{ ...save, run: { ...save.run, dungeon: "not a dungeon" } }, { roomCode: "JKLMNP", members: "nope" }],
      }),
      "utf8",
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const store = new RoomSaveStore(createFileRoomSaveStorage(path), { now: () => 6_000, contentVersion: VERSION });
    expect(store.get(ROOM)).toEqual({ ...save, run: null });
    expect(store.has("JKLMNP")).toBe(false);
  });
});
