import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_APPEARANCE } from "../../src/shared/constants/appearance.js";
import { RUN_AUTOSAVE_INTERVAL_MS, SAVE_QUIT_COMBAT_GRACE_MS } from "../../src/shared/constants/game.js";
import { createGameServer, type GameServer } from "../../src/server/gameServer.js";
import { saveAndQuit, saveAndQuitRefusal } from "../../src/server/game/saveAndQuit.js";
import { returnToHub, startRun } from "../../src/server/game/runLifecycle.js";
import { markCombat } from "../../src/server/game/vitals.js";
import { createMemoryRoomSaveStorage, RoomSaveStore } from "../../src/server/saves/roomSaveStore.js";
import { saveRoom } from "../../src/server/saves/roomSaving.js";
import { SessionStore, type Session, type SessionPlayer } from "../../src/server/sessions/sessionStore.js";
import type { InventoryItem } from "../../src/shared/types/core.js";
import { at, joinRequest, testProfile, TONIC_FIELDS } from "./fixtures.js";

const ROOM = "BCDFGH";
const WALL = 1_700_000_000_000;
const TONIC: InventoryItem = { id: "44444444-4444-4444-8444-444444444444", name: "Minor Tonic", ...TONIC_FIELDS };

/** The game clock the server and these tests share; tests move it by hand. */
let clock = 10_000;

interface Party {
  server: GameServer;
  store: SessionStore;
  saves: RoomSaveStore;
  session: Session;
  players: SessionPlayer[];
}

interface PartyOptions {
  /** Ready the party and start the run. On by default; off leaves them in the hub. */
  run?: boolean;
  roomCode?: string;
  emptySessionTtlMs?: number;
}

/** A room in the hub with a designed, connected player per name. */
function party(names: string[], options: PartyOptions = {}): Party {
  const { run = true, roomCode = ROOM, emptySessionTtlMs } = options;
  const saves = new RoomSaveStore(createMemoryRoomSaveStorage(), { now: () => WALL });
  const store = new SessionStore({
    dungeon: { dungeonId: "ember-vault" },
    createRoomCode: () => roomCode,
    saves,
    ...(emptySessionTtlMs === undefined ? {} : { emptySessionTtlMs }),
  });
  const server = createGameServer({ store, now: () => clock, wallNow: () => WALL, log: false });
  const session = store.createSession();
  const players = names.map((playerName, index) => {
    // A saved profile id must be a UUID; the fixture default is not.
    const id = `${String(index + 1).padStart(8, "0")}-0000-4000-8000-000000000000`;
    const joined = store.join(
      joinRequest({ roomCode, playerName, createProfile: () => testProfile(playerName, { id }) }),
    );
    if (!joined.ok) throw new Error(joined.message);
    store.setAppearance(joined.player.id, DEFAULT_APPEARANCE);
    return joined.player;
  });
  if (run) {
    for (const player of players) player.ready = true;
    expect(startRun(session, clock)).toEqual({ ok: true });
  }
  return { server, store, saves, session, players };
}

const open: Party[] = [];

function openParty(names: string[], options: PartyOptions = {}): Party {
  const created = party(names, options);
  open.push(created);
  return created;
}

beforeEach(() => {
  clock = 10_000;
  // Only the intervals, so the servers here never touch a socket or a real timer.
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
});

afterEach(async () => {
  vi.useRealTimers();
  for (const created of open.splice(0)) await created.server.close();
});

describe("autosave", () => {
  it("writes a dungeon session's run on the interval, and again as it changes", () => {
    const { saves, players } = openParty(["Alpha", "Beta"]);
    expect(saves.get(ROOM)).toBeUndefined();

    vi.advanceTimersByTime(RUN_AUTOSAVE_INTERVAL_MS - 1);
    expect(saves.get(ROOM)).toBeUndefined();
    vi.advanceTimersByTime(1);

    const first = saves.get(ROOM);
    expect(first?.run?.players).toHaveLength(2);
    expect(first?.members.map((member) => member.name).sort()).toEqual(["Alpha", "Beta"]);
    expect(first?.lastPlayedAt).toBe(WALL);

    players[0]!.position = at(5, 5);
    players[0]!.inventory = [{ ...TONIC }];
    vi.advanceTimersByTime(RUN_AUTOSAVE_INTERVAL_MS);

    const entry = saves.get(ROOM)?.run?.players.find((candidate) => candidate.profileId === players[0]!.profile.id);
    expect(entry?.position).toEqual(at(5, 5));
    expect(entry?.inventory).toHaveLength(1);
  });

  it("writes nothing for a session in the hub", () => {
    const { saves } = openParty(["Alpha"], { run: false });

    vi.advanceTimersByTime(RUN_AUTOSAVE_INTERVAL_MS * 3);

    expect(saves.get(ROOM)).toBeUndefined();
  });

  it("gives a hub session members and no run when its characters are saved", () => {
    const { saves, session } = openParty(["Alpha", "Beta"], { run: false });

    saveRoom(session, saves, clock, WALL);

    expect(saves.get(ROOM)?.members).toHaveLength(2);
    expect(saves.get(ROOM)?.run).toBeNull();
  });

  it("writes nothing for a hub with no characters in it", () => {
    const { saves, session } = openParty([], { run: false });

    saveRoom(session, saves, clock, WALL);

    expect(saves.get(ROOM)).toBeUndefined();
  });
});

describe("an emptied party and shutdown", () => {
  it("saves a dungeon whose last member is gone before the sweep deletes the session", () => {
    const { store, saves, players } = openParty(["Alpha", "Beta"], { emptySessionTtlMs: 0 });
    players[0]!.position = at(4, 3);
    for (const player of players) store.markDisconnected(player.id);

    vi.advanceTimersByTime(5_000);

    const run = saves.get(ROOM)?.run;
    expect(run?.players).toHaveLength(2);
    expect(run?.players.find((entry) => entry.profileId === players[0]!.profile.id)?.position).toEqual(at(4, 3));
  });

  it("writes every dungeon session at close(), through to storage", async () => {
    const storage = createMemoryRoomSaveStorage();
    const saves = new RoomSaveStore(storage, { now: () => WALL });
    const store = new SessionStore({ dungeon: { dungeonId: "ember-vault" }, createRoomCode: () => ROOM, saves });
    const server = createGameServer({ store, now: () => clock, wallNow: () => WALL, log: false });
    const session = store.createSession();
    const joined = store.join(
      joinRequest({
        roomCode: ROOM,
        playerName: "Alpha",
        createProfile: () => testProfile("Alpha", { id: "00000001-0000-4000-8000-000000000000" }),
      }),
    );
    if (!joined.ok) throw new Error(joined.message);
    store.setAppearance(joined.player.id, DEFAULT_APPEARANCE);
    joined.player.ready = true;
    startRun(session, clock);
    joined.player.position = at(6, 2);

    await server.close();

    const written = storage.read()?.rooms.find((room) => room.roomCode === ROOM);
    expect(written?.run?.players[0]?.position).toEqual(at(6, 2));
  });
});

describe("the end of a run", () => {
  it.each([
    ["an escape", true],
    ["a wipe", false],
  ])("clears the run on %s and keeps every member", (_name, escaped) => {
    const { session, saves } = openParty(["Alpha", "Beta"]);
    saveRoom(session, saves, clock, WALL);
    expect(saves.get(ROOM)?.run).not.toBeNull();

    returnToHub(session, escaped);

    const save = saves.get(ROOM);
    expect(save?.run).toBeNull();
    expect(save?.members.map((member) => member.name).sort()).toEqual(["Alpha", "Beta"]);
  });

  it("banks nothing for a member who saved and quit and did not return", () => {
    const { store, saves, session, players } = openParty(["Alpha", "Beta"]);
    const [alpha, beta] = players as [SessionPlayer, SessionPlayer];
    beta.inventory = [{ ...TONIC }];
    beta.runCoin = 30;
    beta.runSkillStacks.set("iron-will", 1);
    const before = structuredClone({ coin: beta.profile.coin, skillStacks: beta.profile.skillStacks });

    expect(saveAndQuit(store, beta.id, clock, WALL).ok).toBe(true);
    expect(saves.get(ROOM)?.run?.players.map((entry) => entry.profileId)).toContain(beta.profile.id);

    returnToHub(session, true);

    expect(saves.get(ROOM)?.run).toBeNull();
    expect(saves.get(ROOM)?.members).toHaveLength(2);
    expect(session.vault.items).toEqual([]);
    expect(beta.profile.coin).toBe(before.coin);
    expect(beta.profile.skillStacks).toEqual(before.skillStacks);
    expect(alpha.profile.runsEscaped).toBe(1);
  });
});

describe("save and quit", () => {
  it("removes the player, keeps their carry and position, and leaves the party playing", () => {
    const { store, saves, session, players } = openParty(["Alpha", "Beta"]);
    const [alpha, beta] = players as [SessionPlayer, SessionPlayer];
    beta.position = at(7, 4);
    beta.inventory = [{ ...TONIC }];
    beta.runCoin = 9;

    const result = saveAndQuit(store, beta.id, clock, WALL);

    expect(result.ok).toBe(true);
    expect(session.players.has(beta.id)).toBe(false);
    expect(store.findMember(beta.id)).toBeUndefined();
    expect(session.players.has(alpha.id)).toBe(true);
    expect(session.location).toBe("dungeon");

    const entry = saves.get(ROOM)?.run?.players.find((candidate) => candidate.profileId === beta.profile.id);
    expect(entry?.position).toEqual(at(7, 4));
    expect(entry?.inventory).toHaveLength(1);
    expect(entry?.runCoin).toBe(9);

    // A later autosave keeps the absent member's entry rather than dropping it.
    saveRoom(session, saves, clock + 1_000, WALL);
    expect(saves.get(ROOM)?.run?.players).toHaveLength(2);
  });

  it("is refused in the hub, changing nothing", () => {
    const { store, saves, session, players } = openParty(["Alpha"], { run: false });

    expect(saveAndQuit(store, players[0]!.id, clock, WALL)).toEqual({ ok: false, reason: "notPermitted" });
    expect(session.players.has(players[0]!.id)).toBe(true);
    expect(saves.get(ROOM)).toBeUndefined();
  });

  it("is refused for a player who took or dealt damage lately, until the grace passes", () => {
    const { store, saves, session, players } = openParty(["Alpha", "Beta"]);
    const beta = players[1]!;
    markCombat(beta, clock);

    clock += SAVE_QUIT_COMBAT_GRACE_MS - 1;
    expect(saveAndQuit(store, beta.id, clock, WALL)).toEqual({ ok: false, reason: "inCombat" });
    expect(session.players.has(beta.id)).toBe(true);
    expect(saves.get(ROOM)).toBeUndefined();

    clock += 1;
    expect(saveAndQuit(store, beta.id, clock, WALL).ok).toBe(true);
  });

  it("is refused while a monster is winding up or charging at the player, but not far away", () => {
    const { session, players } = openParty(["Alpha"]);
    const alpha = players[0]!;
    const monster = session.dungeon.monsters.find((candidate) => candidate.alive);
    if (!monster) throw new Error("The test dungeon has no monsters");

    session.monsterWindups.set(monster.id, clock);
    alpha.position = { ...monster.position };
    expect(saveAndQuitRefusal(session, alpha, clock)).toBe("inCombat");

    alpha.position = { x: monster.position.x + 500, y: monster.position.y };
    expect(saveAndQuitRefusal(session, alpha, clock)).toBeNull();

    session.monsterWindups.delete(monster.id);
    session.monsterCharges.set(monster.id, { travelled: 0, stunnedUntil: null });
    alpha.position = { ...monster.position };
    expect(saveAndQuitRefusal(session, alpha, clock)).toBe("inCombat");

    // A stunned charger has spent its dash.
    session.monsterCharges.set(monster.id, { travelled: 0, stunnedUntil: clock + 1_000 });
    expect(saveAndQuitRefusal(session, alpha, clock)).toBeNull();
  });

  it("is refused for a player who is downed or being carried, so a save is no way out of death", () => {
    const { store, saves, session, players } = openParty(["Alpha", "Beta"]);
    const [alpha, beta] = players as [SessionPlayer, SessionPlayer];

    beta.health = 0;
    expect(saveAndQuit(store, beta.id, clock, WALL)).toEqual({ ok: false, reason: "notPermitted" });

    alpha.carryingPlayerId = beta.id;
    beta.carriedByPlayerId = alpha.id;
    expect(saveAndQuit(store, beta.id, clock, WALL)).toEqual({ ok: false, reason: "notPermitted" });

    expect(session.players.has(beta.id)).toBe(true);
    expect(saves.get(ROOM)).toBeUndefined();
  });

  it("sets down whoever a quitting carrier was hauling", () => {
    const { store, players } = openParty(["Alpha", "Beta"]);
    const [alpha, beta] = players as [SessionPlayer, SessionPlayer];
    beta.health = 0;
    alpha.carryingPlayerId = beta.id;
    beta.carriedByPlayerId = alpha.id;

    expect(saveAndQuit(store, alpha.id, clock, WALL).ok).toBe(true);
    expect(beta.carriedByPlayerId).toBeNull();
  });

  it("is refused for a player who is not in a session", () => {
    const { store } = openParty(["Alpha"]);

    expect(saveAndQuit(store, "nobody", clock, WALL)).toEqual({ ok: false, reason: "notPermitted" });
  });
});
