import { describe, expect, it } from "vitest";
import { DEFAULT_APPEARANCE } from "../../src/shared/constants/appearance.js";
import { RECONNECT_GRACE_MS } from "../../src/shared/constants/game.js";
import { returnToHub, startRun } from "../../src/server/game/runLifecycle.js";
import { saveAndQuit } from "../../src/server/game/saveAndQuit.js";
import { storeInVault } from "../../src/server/game/vault.js";
import { roomSaveSchema } from "../../src/server/saves/roomSave.js";
import { createMemoryRoomSaveStorage, RoomSaveStore } from "../../src/server/saves/roomSaveStore.js";
import { saveRoom } from "../../src/server/saves/roomSaving.js";
import type { PlayerProfile } from "../../src/server/profiles/profile.js";
import { SessionStore, type JoinResult, type Session, type SessionPlayer } from "../../src/server/sessions/sessionStore.js";
import { createMemoryVaultStorage, VaultStore } from "../../src/server/vaults/vaultStore.js";
import type { InventoryItem } from "../../src/shared/types/core.js";
import { at, joinRequest, testProfile, TONIC_FIELDS } from "./fixtures.js";

const ROOM = "BCDFGH";
const WALL = 1_700_000_000_000;
const DAY_MS = 24 * 60 * 60_000;
const TRAP_ID = "77777777-7777-4777-8777-777777777777";
const TONIC: InventoryItem = { id: "44444444-4444-4444-8444-444444444444", name: "Minor Tonic", ...TONIC_FIELDS };

/** The game clock every server in a test shares; tests move it by hand. */
let clock = 10_000;

function profileFor(name: string, index: number): PlayerProfile {
  return testProfile(name, { id: `${String(index + 1).padStart(8, "0")}-0000-4000-8000-000000000000` });
}

/**
 * One server process over files that outlive it. `restart` builds a new store over the same
 * storage, which is what a restart does: nothing but the files carries over.
 */
class World {
  readonly roomStorage = createMemoryRoomSaveStorage();
  readonly vaultStorage = createMemoryVaultStorage();
  wall = WALL;
  readonly profiles = new Map<string, PlayerProfile>();
  store!: SessionStore;
  saves!: RoomSaveStore;

  constructor(options: { contentVersion?: string } = {}) {
    this.boot(options);
  }

  boot(options: { contentVersion?: string } = {}): void {
    clock += 1;
    this.saves = new RoomSaveStore(this.roomStorage, {
      now: () => this.wall,
      ...(options.contentVersion === undefined ? {} : { contentVersion: options.contentVersion }),
    });
    this.store = new SessionStore({
      dungeon: { dungeonId: "ember-vault" },
      createRoomCode: () => ROOM,
      now: () => clock,
      saves: this.saves,
      vaults: new VaultStore(this.vaultStorage),
    });
  }

  /** The server went away and came back: sessions and tokens are gone, files are not. */
  restart(options: { contentVersion?: string } = {}): void {
    this.saves.flush();
    this.store.vaults.flush();
    this.boot(options);
  }

  profile(name: string): PlayerProfile {
    let profile = this.profiles.get(name);
    if (profile === undefined) {
      profile = profileFor(name, this.profiles.size);
      this.profiles.set(name, profile);
    }
    return profile;
  }

  join(name: string, savedRun?: "continue" | "discard" | null): JoinResult {
    return this.store.join(
      joinRequest({ roomCode: ROOM, playerName: name, profile: this.profile(name), ...(savedRun === undefined ? {} : { savedRun }) }),
    );
  }

  joined(name: string, savedRun?: "continue" | "discard" | null): SessionPlayer {
    const result = this.join(name, savedRun);
    if (!result.ok) throw new Error(`${name}: ${result.code}`);
    return result.player;
  }

  /** Writes the room's save the way an autosave would. */
  save(session: Session, wall = this.wall): void {
    saveRoom(session, this.saves, clock, wall);
    this.saves.flush();
  }
}

/** A hub room with a designed player per name. */
function hubParty(names: string[], world = new World()): { world: World; session: Session; players: SessionPlayer[] } {
  const session = world.store.createSession();
  const players = names.map((name) => {
    const player = world.joined(name);
    world.store.setAppearance(player.id, { ...DEFAULT_APPEARANCE, hairColor: name === "Beta" ? "black" : "brown" });
    return player;
  });
  return { world, session, players };
}

/** A run in progress with distinctive state on every member, written to the room's save. */
function runningParty(names: string[]): { world: World; session: Session; players: SessionPlayer[] } {
  const party = hubParty(names);
  for (const player of party.players) player.ready = true;
  expect(startRun(party.session, clock)).toEqual({ ok: true });

  party.players.forEach((player, index) => {
    player.position = at(5 + index, 4);
    player.health = 70 - index * 10;
    player.stamina = 40 + index;
    player.inventory = [{ ...TONIC, id: `44444444-4444-4444-8444-44444444444${index}` }];
    player.runSkillStacks.set("iron-will", index + 1);
    player.runCoin = 12 + index;
    player.discoveredTiles[3 + index] = 1;
    player.discoveredRoomIds.add(`room-${index}`);
  });
  const monster = party.session.dungeon.monsters[0]!;
  monster.health -= 7;
  party.session.monsterCooldowns.set(monster.id, clock + 4_000);
  party.session.trapRearmAt.set(TRAP_ID, clock + 9_000);
  party.world.save(party.session);
  return party;
}

describe("continuing a saved run after a restart", () => {
  it("puts two members back where they were, with everything they carried", () => {
    const { world, session, players } = runningParty(["Alpha", "Beta"]);
    const monster = session.dungeon.monsters[0]!;
    const before = players.map((player) => ({
      name: player.name,
      position: player.position,
      health: player.health,
      stamina: player.stamina,
      inventory: player.inventory,
      stacks: [...player.runSkillStacks],
      coin: player.runCoin,
    }));
    const monsterHealth = monster.health;
    const elapsed = clock - players[0]!.enteredDungeonAt!;

    world.restart();
    clock += 120_000;
    expect(world.store.getSession(ROOM)).toBeUndefined();
    const alpha = world.joined("Alpha", "continue");
    const beta = world.joined("Beta", "continue");

    const restored = world.store.getSession(ROOM)!;
    expect(restored.location).toBe("dungeon");
    expect(restored.players.size).toBe(2);
    for (const [player, expected] of [[alpha, before[0]!], [beta, before[1]!]] as const) {
      expect(player.position).toEqual(expected.position);
      expect(player.health).toBe(expected.health);
      expect(player.stamina).toBe(expected.stamina);
      expect(player.inventory).toEqual(expected.inventory);
      expect([...player.runSkillStacks]).toEqual(expected.stacks);
      expect(player.runCoin).toBe(expected.coin);
      expect(player.appearance).not.toBeNull();
    }
    expect(restored.dungeon.monsters.find((candidate) => candidate.id === monster.id)?.health).toBe(monsterHealth);
    expect(alpha.discoveredTiles[3]).toBe(1);
    expect(alpha.discoveredRoomIds.has("room-0")).toBe(true);

    // The run clock and the timers paused while the room was saved.
    expect(clock - alpha.enteredDungeonAt!).toBe(elapsed);
    expect(restored.monsterCooldowns.get(monster.id)).toBe(clock + 4_000);
    expect(restored.trapRearmAt.get(TRAP_ID)).toBe(clock + 9_000);
  });

  it("gives a continuing member a fresh resume token", () => {
    const { world, players } = runningParty(["Alpha"]);
    const oldToken = players[0]!.resumeToken;

    world.restart();
    const alpha = world.joined("Alpha", "continue");

    expect(alpha.resumeToken).not.toBe(oldToken);
    expect(alpha.connected).toBe(true);
  });

  it("lets a subset continue, keeps the absent member through autosaves, and restores them on return", () => {
    const { world, players } = runningParty(["Alpha", "Beta"]);
    const betaProfileId = players[1]!.profile.id;

    world.restart();
    const alpha = world.joined("Alpha", "continue");
    const session = world.store.getSession(ROOM)!;
    alpha.position = at(8, 8);
    world.save(session);
    world.save(session);

    const saved = world.saves.get(ROOM)!;
    expect(saved.run?.players.map((entry) => entry.profileId).sort()).toEqual(
      [alpha.profile.id, betaProfileId].sort(),
    );

    // Beta comes back into the live session, with their own carry and not Alpha's.
    const beta = world.joined("Beta", "continue");
    expect(beta.position).toEqual(at(6, 4));
    expect(beta.inventory.map((item) => item.id)).toEqual(["44444444-4444-4444-8444-444444444441"]);
    expect(beta.runCoin).toBe(13);
    expect(alpha.position).toEqual(at(8, 8));
    expect(beta.id).not.toBe(alpha.id);
  });

  it("continues into a live session for a member who is not in it yet", () => {
    const { world } = runningParty(["Alpha", "Beta"]);

    world.restart();
    const alpha = world.joined("Alpha", "continue");
    const session = world.store.getSession(ROOM)!;
    const beta = world.joined("Beta", "continue");

    expect(world.store.getSession(ROOM)).toBe(session);
    expect(session.players.size).toBe(2);
    expect(beta.position).toEqual(at(6, 4));
    expect(alpha.position).toEqual(at(5, 4));
  });

  it("refuses a non-member and a join with no profile secret, leaving the save unchanged", () => {
    const { world } = runningParty(["Alpha"]);
    world.restart();
    const before = world.saves.get(ROOM);
    let minted = 0;

    const stranger = world.join("Stranger", "continue");
    const anonymous = world.store.join(
      joinRequest({
        roomCode: ROOM,
        playerName: "Nobody",
        savedRun: "continue",
        createProfile: () => {
          minted += 1;
          return testProfile("Nobody");
        },
      }),
    );
    const discard = world.join("Stranger", "discard");

    expect(stranger).toMatchObject({ ok: false, code: "notSaveMember" });
    expect(anonymous).toMatchObject({ ok: false, code: "notSaveMember" });
    expect(discard).toMatchObject({ ok: false, code: "notSaveMember" });
    expect(minted).toBe(0);
    expect(world.store.getSession(ROOM)).toBeUndefined();
    expect(world.saves.get(ROOM)).toEqual(before);
  });

  it("refuses a second join with the same profile", () => {
    const { world } = runningParty(["Alpha"]);
    world.restart();
    world.joined("Alpha", "continue");

    expect(world.join("Alpha", "continue")).toMatchObject({ ok: false, code: "profileInUse" });
  });

  it("refuses a new player into a run that is live and continued", () => {
    const { world } = runningParty(["Alpha"]);
    world.restart();
    world.joined("Alpha", "continue");

    expect(world.join("Stranger", "continue")).toMatchObject({ ok: false, code: "notSaveMember" });
    expect(world.store.getSession(ROOM)!.players.size).toBe(1);
  });

  it("keeps a member's entry and a valid save when they disconnect right after restoring", () => {
    const { world } = runningParty(["Alpha"]);
    world.restart();
    const alpha = world.joined("Alpha", "continue");

    world.store.markDisconnected(alpha.id);
    clock += RECONNECT_GRACE_MS + 1;
    expect(world.store.sweep()).toHaveLength(1);

    const saved = world.saves.get(ROOM)!;
    expect(roomSaveSchema.safeParse(saved).success).toBe(true);
    expect(saved.run?.players.map((entry) => entry.profileId)).toEqual([alpha.profile.id]);
    world.restart();
    expect(world.join("Alpha", "continue").ok).toBe(true);
  });
});

describe("a room whose save has no run", () => {
  it("reopens in the hub after a restart, keeps its members, and takes new players", () => {
    const { world } = hubParty(["Alpha", "Beta"]);
    world.save(world.store.getSession(ROOM)!);

    world.restart();
    const newcomer = world.join("Gamma");
    const alpha = world.joined("Alpha");

    expect(newcomer.ok).toBe(true);
    const session = world.store.getSession(ROOM)!;
    expect(session.location).toBe("hub");
    expect(session.players.size).toBe(2);
    expect(world.saves.get(ROOM)?.members.map((member) => member.name).sort()).toEqual(["Alpha", "Beta"]);
    // A returning member arrives as the character the save holds, with no designer in the way.
    expect(alpha.appearance).toEqual({ ...DEFAULT_APPEARANCE, hairColor: "brown" });
  });

  it("does not need savedRun to join", () => {
    const { world } = hubParty(["Alpha"]);
    world.save(world.store.getSession(ROOM)!);
    world.restart();

    expect(world.join("Alpha", "continue").ok).toBe(true);
  });

  it("opens a content-stale save in the hub with its members and no run", () => {
    const { world } = runningParty(["Alpha", "Beta"]);

    world.restart({ contentVersion: "a-later-content-version" });
    const alpha = world.join("Alpha");

    expect(alpha.ok).toBe(true);
    expect(world.store.getSession(ROOM)!.location).toBe("hub");
    expect(world.saves.get(ROOM)?.run).toBeNull();
    expect(world.saves.get(ROOM)?.members).toHaveLength(2);
  });
});

describe("saved run prompt and discarding", () => {
  it("answers a member's join without savedRun with savedRunExists", () => {
    const { world } = runningParty(["Alpha"]);
    world.restart();
    const before = world.saves.get(ROOM);

    expect(world.join("Alpha")).toMatchObject({ ok: false, code: "savedRunExists" });
    expect(world.join("Alpha", null)).toMatchObject({ ok: false, code: "savedRunExists" });
    expect(world.saves.get(ROOM)).toEqual(before);
    expect(world.store.getSession(ROOM)).toBeUndefined();
  });

  it("discards the run and the members but keeps the party vault", () => {
    const { world, session } = hubParty(["Alpha", "Beta"]);
    storeInVault(session, { ...TONIC });
    for (const player of session.players.values()) player.ready = true;
    startRun(session, clock);
    world.save(session);

    world.restart();
    const alpha = world.joined("Alpha", "discard");

    const reopened = world.store.getSession(ROOM)!;
    expect(reopened.location).toBe("hub");
    expect(reopened.vault.items).toHaveLength(1);
    expect(alpha.appearance).toBeNull();
    expect(world.saves.has(ROOM)).toBe(false);
    // The new save starts from the next write, with only the people in the room now.
    world.store.setAppearance(alpha.id, DEFAULT_APPEARANCE);
    world.save(reopened);
    expect(world.saves.get(ROOM)).toMatchObject({ run: null, members: [{ name: "Alpha" }] });
    expect(world.join("Beta", "continue").ok).toBe(true);
  });

  it("refuses to discard while another member is connected to the run", () => {
    const { world } = runningParty(["Alpha", "Beta"]);
    world.restart();
    world.joined("Alpha", "continue");
    const before = world.saves.get(ROOM);

    expect(world.join("Beta", "discard")).toMatchObject({ ok: false, code: "notPermitted" });
    expect(world.saves.get(ROOM)).toEqual(before);
    expect(world.store.getSession(ROOM)!.players.size).toBe(1);
  });

  it("discards once the other member has dropped off the run", () => {
    const { world } = runningParty(["Alpha", "Beta"]);
    world.restart();
    const alpha = world.joined("Alpha", "continue");
    world.store.markDisconnected(alpha.id);

    expect(world.join("Beta", "discard").ok).toBe(true);
    expect(world.store.getSession(ROOM)!.location).toBe("hub");
    expect(world.store.getSession(ROOM)!.players.size).toBe(1);
  });
});

describe("a member who saved and quit while the party finished the run", () => {
  it("arrives in the hub with their character and none of their old carry", () => {
    const { world, session, players } = runningParty(["Alpha", "Beta"]);
    const [alpha, beta] = players as [SessionPlayer, SessionPlayer];
    expect(saveAndQuit(world.store, beta.id, clock, world.wall).ok).toBe(true);

    returnToHub(session, true);
    expect(alpha.inventory).toEqual([]);
    world.restart();
    const rejoined = world.joined("Beta");

    expect(world.store.getSession(ROOM)!.location).toBe("hub");
    expect(rejoined.appearance).not.toBeNull();
    expect(rejoined.inventory).toEqual([]);
    expect(rejoined.runCoin).toBe(0);
    expect(rejoined.runSkillStacks.size).toBe(0);
    expect(world.saves.get(ROOM)?.run).toBeNull();
  });
});

describe("expiry", () => {
  it("does not restore a save last played more than seven days ago", () => {
    const { world } = runningParty(["Alpha"]);
    world.restart();

    world.wall += 7 * DAY_MS + 1;
    world.boot();

    expect(world.join("Alpha", "continue")).toMatchObject({ ok: false, code: "sessionNotFound" });
  });

  it("drops a save that lapsed while the server was running", () => {
    const { world } = runningParty(["Alpha"]);
    world.restart();
    world.wall += 7 * DAY_MS - 1;
    // Loaded in time, then left alone past the limit.
    world.saves = new RoomSaveStore(world.roomStorage, { now: () => world.wall });
    world.store = new SessionStore({
      dungeon: { dungeonId: "ember-vault" },
      createRoomCode: () => ROOM,
      now: () => clock,
      saves: world.saves,
      vaults: new VaultStore(world.vaultStorage),
    });
    world.wall += 2;

    expect(world.join("Alpha", "continue")).toMatchObject({ ok: false, code: "sessionNotFound" });
    expect(world.saves.has(ROOM)).toBe(false);
  });

  it("restores a save played just inside the limit", () => {
    const { world } = runningParty(["Alpha"]);
    world.restart();
    world.wall += 7 * DAY_MS - 1;

    expect(world.join("Alpha", "continue").ok).toBe(true);
  });
});
