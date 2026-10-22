import { describe, expect, it } from "vitest";
import { DEFAULT_APPEARANCE, HAIR_COLORS, HAIR_STYLES } from "../../src/shared/constants/appearance.js";
import { gameContent } from "../../src/server/content/loadContent.js";
import { startRun } from "../../src/server/game/runLifecycle.js";
import type { PlayerProfile } from "../../src/server/profiles/profile.js";
import { resolveAppearance, resolvePartyColor, type RoomSave } from "../../src/server/saves/roomSave.js";
import { createMemoryRoomSaveStorage, RoomSaveStore } from "../../src/server/saves/roomSaveStore.js";
import { saveRoom } from "../../src/server/saves/roomSaving.js";
import { savedRunCardsFor } from "../../src/server/saves/savedRunList.js";
import { SessionStore, type Session, type SessionPlayer } from "../../src/server/sessions/sessionStore.js";
import { createMemoryVaultStorage, VaultStore } from "../../src/server/vaults/vaultStore.js";
import { joinRequest, testProfile } from "./fixtures.js";

const WALL = 1_700_000_000_000;
const DAY_MS = 24 * 60 * 60_000;
const ROOMS = ["BCDFGH", "JKLMNP"] as const;

let clock = 10_000;

function profileFor(index: number): PlayerProfile {
  return testProfile(`P${index}`, { id: `${String(index + 1).padStart(8, "0")}-0000-4000-8000-000000000000` });
}

const ALPHA = profileFor(0);
const BETA = profileFor(1);
const GAMMA = profileFor(2);

/** Two servers' worth of files: `restart` is a new store over the same storage. */
class World {
  readonly storage = createMemoryRoomSaveStorage();
  readonly vaultStorage = createMemoryVaultStorage();
  wall = WALL;
  store!: SessionStore;
  saves!: RoomSaveStore;
  #nextRoom = 0;

  constructor() {
    this.boot();
  }

  boot(contentVersion?: string): void {
    clock += 1;
    this.saves = new RoomSaveStore(this.storage, {
      now: () => this.wall,
      ...(contentVersion === undefined ? {} : { contentVersion }),
    });
    this.store = new SessionStore({
      dungeon: { dungeonId: "ember-vault" },
      createRoomCode: () => ROOMS[this.#nextRoom++]!,
      now: () => clock,
      saves: this.saves,
      vaults: new VaultStore(this.vaultStorage),
    });
  }

  restart(contentVersion?: string): void {
    this.saves.flush();
    this.store.vaults.flush();
    this.boot(contentVersion);
  }

  join(session: Session, profile: PlayerProfile, name: string, hairColor: (typeof HAIR_COLORS)[number]): SessionPlayer {
    const result = this.store.join(joinRequest({ roomCode: session.roomCode, playerName: name, profile }));
    if (!result.ok) throw new Error(`${name}: ${result.code}`);
    this.store.setAppearance(result.player.id, { ...DEFAULT_APPEARANCE, hairColor });
    return result.player;
  }

  /** A room whose members are in a dungeon run and saved, the way an autosave would leave it. */
  runningRoom(members: [PlayerProfile, string, (typeof HAIR_COLORS)[number]][]): Session {
    const session = this.store.createSession();
    const players = members.map(([profile, name, hair]) => this.join(session, profile, name, hair));
    for (const player of players) player.ready = true;
    expect(startRun(session, clock)).toEqual({ ok: true });
    saveRoom(session, this.saves, clock + 60_000 * 34, this.wall);
    this.saves.flush();
    return session;
  }

  cards(profile: PlayerProfile) {
    return savedRunCardsFor(this.saves.all(), profile.id, gameContent(), (save) => this.saves.isExpired(save));
  }
}

describe("a saved look whose ids left the shared lists", () => {
  it("falls back, field by field, to the first entry of each list", () => {
    const look = resolveAppearance({ body: "wizard", skinTone: "deep", hairStyle: "mohawk", hairColor: "azure" });

    expect(look).toEqual({
      body: DEFAULT_APPEARANCE.body,
      skinTone: "deep",
      hairStyle: HAIR_STYLES[0],
      hairColor: "azure",
    });
  });

  it("keeps a look whose ids all still exist, and drops an unknown party colour", () => {
    expect(resolveAppearance({ body: "girl", skinTone: "tan", hairStyle: "bun", hairColor: "silver" })).toEqual({
      body: "girl",
      skinTone: "tan",
      hairStyle: "bun",
      hairColor: "silver",
    });
    expect(resolvePartyColor("plum")).toBe("plum");
    expect(resolvePartyColor("chartreuse")).toBeNull();
  });

  it("loads a removed hair colour as the first entry when the member returns after a restart", () => {
    const world = new World();
    const session = world.runningRoom([[ALPHA, "Alpha", "brown"]]);
    const save = world.saves.get(session.roomCode)!;
    save.members[0]!.appearance = { body: "girl", skinTone: "tan", hairStyle: "retired-style", hairColor: "retired-colour" };
    world.saves.put(save);

    world.restart();
    const result = world.store.join(
      joinRequest({ roomCode: session.roomCode, playerName: "Alpha", profile: ALPHA, savedRun: "continue" }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.player.appearance).toEqual({
      body: "girl",
      skinTone: "tan",
      hairStyle: HAIR_STYLES[0],
      hairColor: HAIR_COLORS[0],
    });
  });

  it("falls back on the Continue card too", () => {
    const world = new World();
    const session = world.runningRoom([[ALPHA, "Alpha", "brown"]]);
    const save = world.saves.get(session.roomCode)!;
    save.members[0]!.appearance = { body: "girl", skinTone: "tan", hairStyle: "bun", hairColor: "retired-colour" };
    save.members[0]!.partyColor = "retired-colour";
    world.saves.put(save);

    const [card] = world.cards(ALPHA);

    expect(card?.character.appearance.hairColor).toBe(HAIR_COLORS[0]);
    expect(card?.character.partyColor).toBe("ember");
  });
});

describe("the Continue list", () => {
  it("shows a member their character, the dungeon, time played, last played and teammates", () => {
    const world = new World();
    const session = world.runningRoom([
      [ALPHA, "Alpha", "brown"],
      [BETA, "Beta", "black"],
    ]);
    world.wall += 2 * 60 * 60_000;

    world.restart();
    const cards = world.cards(ALPHA);

    expect(cards).toHaveLength(1);
    const [card] = cards;
    expect(card).toMatchObject({
      roomCode: session.roomCode,
      dungeonName: "Ember Vault",
      character: { name: "Alpha", appearance: { ...DEFAULT_APPEARANCE, hairColor: "brown" } },
      teammates: [{ name: "Beta", appearance: { ...DEFAULT_APPEARANCE, hairColor: "black" } }],
      lastPlayedAt: WALL,
    });
    expect(card?.playedMs).toBeGreaterThan(0);
  });

  it("lists only the saves the requesting profile was in the run of", () => {
    const world = new World();
    const first = world.runningRoom([
      [ALPHA, "Alpha", "brown"],
      [BETA, "Beta", "black"],
    ]);
    const second = world.runningRoom([[GAMMA, "Gamma", "azure"]]);

    expect(world.cards(ALPHA).map((card) => card.roomCode)).toEqual([first.roomCode]);
    expect(world.cards(BETA).map((card) => card.roomCode)).toEqual([first.roomCode]);
    expect(world.cards(GAMMA).map((card) => card.roomCode)).toEqual([second.roomCode]);
    expect(world.cards(profileFor(9))).toEqual([]);
  });

  it("does not let a non-member continue someone else's room, which is also why it is not listed", () => {
    const world = new World();
    const session = world.runningRoom([[ALPHA, "Alpha", "brown"]]);
    world.restart();

    expect(world.cards(GAMMA)).toEqual([]);
    const result = world.store.join(
      joinRequest({ roomCode: session.roomCode, playerName: "Gamma", profile: GAMMA, savedRun: "continue" }),
    );
    expect(result).toMatchObject({ ok: false, code: "notSaveMember" });
  });

  it("leaves out a room whose save has no run, such as one a wipe cleared", () => {
    const world = new World();
    const session = world.runningRoom([[ALPHA, "Alpha", "brown"]]);
    world.saves.clearRun(session.roomCode);

    expect(world.cards(ALPHA)).toEqual([]);
  });

  it("leaves out a save not played for 7 days", () => {
    const world = new World();
    world.runningRoom([[ALPHA, "Alpha", "brown"]]);
    world.wall += 7 * DAY_MS + 1;

    expect(world.cards(ALPHA)).toEqual([]);
    world.restart();
    expect(world.cards(ALPHA)).toEqual([]);
  });

  it("leaves out a run saved under other content, while keeping the room's characters", () => {
    const world = new World();
    const session = world.runningRoom([[ALPHA, "Alpha", "brown"]]);
    expect(world.cards(ALPHA)).toHaveLength(1);

    world.restart("a-different-content-version");

    expect(world.cards(ALPHA)).toEqual([]);
    expect(world.saves.get(session.roomCode)?.members).toHaveLength(1);
  });

  it("lists the most recently played save first", () => {
    const world = new World();
    const older = world.runningRoom([[ALPHA, "Alpha", "brown"]]);
    // A profile plays one live room at a time, so the first is left behind by a restart.
    world.restart();
    world.wall += 60_000;
    const newer = world.runningRoom([[ALPHA, "Alpha", "brown"]]);

    expect(world.cards(ALPHA).map((card) => card.roomCode)).toEqual([newer.roomCode, older.roomCode]);
  });

  it("names no dungeon for a run saved before dungeons were recorded", () => {
    const world = new World();
    const session = world.runningRoom([[ALPHA, "Alpha", "brown"]]);
    const save = world.saves.get(session.roomCode) as RoomSave;
    delete save.run!.dungeonId;
    world.saves.put(save);

    expect(world.cards(ALPHA)[0]?.dungeonName).toBeNull();
  });
});
