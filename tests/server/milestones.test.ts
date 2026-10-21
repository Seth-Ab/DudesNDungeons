import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadContent } from "../../src/server/content/loadContent.js";
import { damageMonster } from "../../src/server/game/monsterDamage.js";
import {
  beginRunStats,
  creditRunStats,
  grantMilestones,
  recordPuzzleSolved,
} from "../../src/server/game/milestones.js";
import { progressionUpdateFor } from "../../src/server/game/progression.js";
import { returnToHub, startRun } from "../../src/server/game/runLifecycle.js";
import { damagePlayer } from "../../src/server/game/vitals.js";
import {
  createMilestoneStats,
  persistedProfileSchema,
  toProfileState,
} from "../../src/server/profiles/profile.js";
import { createMemoryProfileStorage, ProfileStore } from "../../src/server/profiles/profileStore.js";
import type { SessionPlayer } from "../../src/server/sessions/sessionStore.js";
import { EMBER_WARDEN_MONSTER_ID, MILESTONE_STATS } from "../../src/shared/constants/game.js";
import type { InventoryItem } from "../../src/shared/types/core.js";
import { MINOR_TONIC_ID, testPlayer, testProfile, testSession, TONIC_FIELDS } from "./fixtures.js";

const PROFILE_ID = "5d6e7f80-9a1b-4c2d-8e3f-4a5b6c7d8e9f";

const tonic = (id: string): InventoryItem => ({ id, name: "Minor Tonic", ...TONIC_FIELDS }) as InventoryItem;

/** A party in a generated run, which has the Ember Warden, so a win is possible. */
function party(...names: string[]) {
  const players = names.map((name) => testPlayer(name, { carryingTorch: false }));
  const session = testSession(players, "vault-run");
  for (const player of players) beginRunStats(player);
  return { players, session };
}

function killWarden(session: ReturnType<typeof testSession>) {
  const warden = session.dungeon.monsters.find((monster) => monster.typeId === EMBER_WARDEN_MONSTER_ID)!;
  damageMonster(session, warden, warden.health);
  return warden;
}

function killEveryBoss(session: ReturnType<typeof testSession>) {
  for (const monster of session.dungeon.monsters) {
    if (monster.boss) damageMonster(session, monster, monster.health);
  }
}

describe("profile stats", () => {
  it("loads an existing profile with every stat at zero", () => {
    const { revision: _revision, stats: _stats, earnedMilestones: _earned, ...stored } = testProfile("legacy");

    const parsed = persistedProfileSchema.parse({ ...stored, id: PROFILE_ID, runsEscaped: 7 });

    expect(parsed.stats).toEqual(createMilestoneStats());
    expect(Object.keys(parsed.stats)).toEqual([...MILESTONE_STATS]);
    expect(parsed.earnedMilestones).toEqual([]);
    // Nothing is backfilled from the older run counters.
    expect(parsed.stats.runsEscaped).toBe(0);
  });

  it("fills in a stat a stored profile is missing and rejects a negative one", () => {
    const { revision: _revision, ...stored } = testProfile("partial");
    const base = { ...stored, id: PROFILE_ID };

    expect(persistedProfileSchema.parse({ ...base, stats: { wins: 3 } }).stats).toEqual({
      ...createMilestoneStats(),
      wins: 3,
    });
    expect(persistedProfileSchema.safeParse({ ...base, stats: { wins: -1 } }).success).toBe(false);
    expect(persistedProfileSchema.safeParse({ ...base, stats: { wins: 1.5 } }).success).toBe(false);
  });

  it("is sent to its owner with the earned milestones", () => {
    const player = testPlayer("alpha");
    player.profile.stats.wins = 2;
    player.profile.earnedMilestones = ["seasoned-escapee"];

    expect(toProfileState(player.profile)).toMatchObject({
      stats: { wins: 2 },
      earnedMilestones: ["seasoned-escapee"],
    });
    expect(progressionUpdateFor(player, loadContent())).toMatchObject({
      stats: { wins: 2 },
      earnedMilestones: ["seasoned-escapee"],
    });
  });
});

describe("crediting stats on extraction", () => {
  it("credits an escape to everyone who gets out, and a full-party escape when all do", () => {
    const { players, session } = party("alpha", "bravo");

    returnToHub(session, true);

    for (const player of players) {
      expect(player.profile.stats).toMatchObject({ runsEscaped: 1, fullPartyEscapes: 1 });
    }
  });

  it("credits nothing on a wipe", () => {
    const { players, session } = party("alpha", "bravo");
    killWarden(session);
    for (const player of players) player.health = 0;

    returnToHub(session, false);

    for (const player of players) {
      expect(player.profile.stats).toEqual(createMilestoneStats());
      expect(player.profile.earnedMilestones).toEqual([]);
    }
  });

  it("credits nothing to a downed player left behind, and no full-party escape to the rest", () => {
    const { players, session } = party("alpha", "bravo");
    const [alpha, bravo] = players as [SessionPlayer, SessionPlayer];
    bravo.health = 0;
    bravo.runStats.leverPuzzlesSolved = 3;

    returnToHub(session, true);

    expect(bravo.profile.stats).toEqual(createMilestoneStats());
    expect(alpha.profile.stats).toMatchObject({ runsEscaped: 1, fullPartyEscapes: 0 });
  });

  it("credits a downed player who is carried out, and credits the carrier for it", () => {
    const { players, session } = party("alpha", "bravo");
    const [alpha, bravo] = players as [SessionPlayer, SessionPlayer];
    bravo.health = 0;
    alpha.carryingPlayerId = bravo.id;
    bravo.carriedByPlayerId = alpha.id;
    bravo.runStats.leverPuzzlesSolved = 2;

    returnToHub(session, true);

    expect(alpha.profile.stats).toMatchObject({
      runsEscaped: 1,
      fullPartyEscapes: 1,
      teammatesCarriedOut: 1,
    });
    expect(bravo.profile.stats).toMatchObject({
      runsEscaped: 1,
      fullPartyEscapes: 1,
      leverPuzzlesSolved: 2,
      teammatesCarriedOut: 0,
    });
  });

  it("counts a win only when the dungeon had a boss and every boss fell", () => {
    const { players, session } = party("alpha");
    const [alpha] = players as [SessionPlayer];
    returnToHub(session, true);
    expect(alpha.profile.stats.wins).toBe(0);

    const cleared = party("bravo");
    killEveryBoss(cleared.session);
    returnToHub(cleared.session, true);
    expect(cleared.players[0]!.profile.stats.wins).toBe(1);

    const bossless = party("charlie");
    bossless.session.dungeon.monsters = bossless.session.dungeon.monsters.filter((monster) => !monster.boss);
    returnToHub(bossless.session, true);
    expect(bossless.players[0]!.profile.stats.wins).toBe(0);
  });

  it("counts the items an extractor banks, held item included", () => {
    const { players, session } = party("alpha", "bravo");
    const [alpha, bravo] = players as [SessionPlayer, SessionPlayer];
    alpha.inventory = [tonic(MINOR_TONIC_ID), tonic("f0000000-0000-4000-8000-000000000001")];
    alpha.held = tonic("f0000000-0000-4000-8000-000000000002");
    bravo.health = 0;
    bravo.inventory = [tonic("f0000000-0000-4000-8000-000000000003")];

    returnToHub(session, true);

    expect(alpha.profile.stats.itemsBanked).toBe(3);
    expect(bravo.profile.stats.itemsBanked).toBe(0);
  });

  it("counts a run without a torch, but not one that carried a torch at any point", () => {
    const { players, session } = party("alpha", "bravo");
    const [alpha, bravo] = players as [SessionPlayer, SessionPlayer];
    bravo.runStats.carriedTorch = true;
    bravo.carryingTorch = false;

    returnToHub(session, true);

    expect(alpha.profile.stats.runsWithoutTorch).toBe(1);
    expect(bravo.profile.stats.runsWithoutTorch).toBe(0);
  });

  it("treats a torch picked up in the hub as carried when the run starts", () => {
    const player = testPlayer("alpha", { carryingTorch: true });

    beginRunStats(player);

    expect(player.runStats.carriedTorch).toBe(true);
  });

  it("credits solved puzzles to every holder and the moth room to whoever found it", () => {
    const { players, session } = party("alpha", "bravo", "charlie");
    const [alpha, bravo, charlie] = players as [SessionPlayer, SessionPlayer, SessionPlayer];
    recordPuzzleSolved([alpha, bravo]);
    recordPuzzleSolved([alpha, bravo]);
    alpha.runStats.mothRoomFound = true;

    returnToHub(session, true);

    expect(alpha.profile.stats).toMatchObject({ leverPuzzlesSolved: 2, mothRoomsFound: 1 });
    expect(bravo.profile.stats).toMatchObject({ leverPuzzlesSolved: 2, mothRoomsFound: 0 });
    expect(charlie.profile.stats).toMatchObject({ leverPuzzlesSolved: 0, mothRoomsFound: 0 });
  });

  it("starts the next run from clean run stats", () => {
    const { players, session } = party("alpha");
    const [alpha] = players as [SessionPlayer];
    alpha.runStats.leverPuzzlesSolved = 4;
    returnToHub(session, true);
    alpha.ready = true;

    startRun(session, 0);

    expect(alpha.runStats.leverPuzzlesSolved).toBe(0);
  });
});

describe("Ember Warden kills", () => {
  it("credits standing players, flawlessly when nobody has been downed this run", () => {
    const { players, session } = party("alpha", "bravo");

    killWarden(session);
    returnToHub(session, true);

    for (const player of players) {
      expect(player.profile.stats).toMatchObject({ emberWardenKills: 1, flawlessEmberWardenKills: 1 });
    }
  });

  it("is not flawless once anyone has been downed, even if they were revived", () => {
    const { players, session } = party("alpha", "bravo");
    const [alpha, bravo] = players as [SessionPlayer, SessionPlayer];
    damagePlayer(bravo, 10_000);
    bravo.health = 30;

    killWarden(session);
    returnToHub(session, true);

    expect(alpha.profile.stats).toMatchObject({ emberWardenKills: 1, flawlessEmberWardenKills: 0 });
    expect(bravo.profile.stats).toMatchObject({ emberWardenKills: 1, flawlessEmberWardenKills: 0 });
  });

  it("does not credit a player who was down when it fell", () => {
    const { players, session } = party("alpha", "bravo");
    const [alpha, bravo] = players as [SessionPlayer, SessionPlayer];
    damagePlayer(bravo, 10_000);

    killWarden(session);
    bravo.health = 50;
    returnToHub(session, true);

    expect(alpha.profile.stats.emberWardenKills).toBe(1);
    expect(bravo.profile.stats.emberWardenKills).toBe(0);
  });

  it("credits nothing for another monster, or for a wounded Warden", () => {
    const { players, session } = party("alpha");
    const [alpha] = players as [SessionPlayer];
    const warden = session.dungeon.monsters.find((monster) => monster.typeId === EMBER_WARDEN_MONSTER_ID)!;
    damageMonster(session, warden, 1);
    const other = session.dungeon.monsters.find((monster) => !monster.boss)!;
    damageMonster(session, other, other.health);

    returnToHub(session, true);

    expect(alpha.profile.stats.emberWardenKills).toBe(0);
  });

  it("is lost with the run when the party wipes after the kill", () => {
    const { players, session } = party("alpha");
    const [alpha] = players as [SessionPlayer];

    killWarden(session);
    alpha.health = 0;
    returnToHub(session, false);

    expect(alpha.profile.stats.emberWardenKills).toBe(0);
  });
});

describe("milestone grants", () => {
  const content = loadContent();
  const milestone = content.milestones.get("seasoned-escapee")!;

  function playerNearThreshold(overrides: Partial<SessionPlayer["profile"]> = {}) {
    const player = testPlayer("alpha", {
      profile: testProfile("alpha", { stats: { ...createMilestoneStats(), runsEscaped: milestone.threshold - 1 }, ...overrides }),
    });
    return { player, session: testSession([player], "vault-run") };
  }

  it("ships a milestone whose skill is milestone-only", () => {
    expect(milestone).toMatchObject({ stat: "runsEscaped", skillId: "emberhardened" });
    expect(content.skills.get(milestone.skillId)?.requires).toEqual([]);
  });

  it("grants one permanent stack when an extraction crosses the threshold", () => {
    const { player, session } = playerNearThreshold();
    expect(player.profile.skillStacks[milestone.skillId]).toBeUndefined();
    const revision = player.profile.revision;

    returnToHub(session, true);

    expect(player.profile.stats.runsEscaped).toBe(milestone.threshold);
    expect(player.profile.skillStacks[milestone.skillId]).toBe(1);
    expect(player.profile.earnedMilestones).toEqual([milestone.id]);
    expect(player.profile.revision).toBeGreaterThan(revision);
  });

  it("grants nothing before the threshold", () => {
    const player = testPlayer("alpha", {
      profile: testProfile("alpha", { stats: { ...createMilestoneStats(), runsEscaped: 1 } }),
    });

    expect(grantMilestones(player, content)).toEqual([]);
    expect(player.profile.skillStacks).toEqual({});
  });

  it("does not grant again on later extractions", () => {
    const { player } = playerNearThreshold();
    for (let run = 0; run < 3; run += 1) {
      const session = testSession([player], "vault-run");
      beginRunStats(player);
      returnToHub(session, true);
    }

    expect(player.profile.skillStacks[milestone.skillId]).toBe(1);
    expect(player.profile.earnedMilestones).toEqual([milestone.id]);
  });

  it("does not grant on a wipe", () => {
    const { player, session } = playerNearThreshold();
    player.health = 0;

    returnToHub(session, false);

    expect(player.profile.stats.runsEscaped).toBe(milestone.threshold - 1);
    expect(player.profile.skillStacks).toEqual({});
  });

  it("records the milestone as earned, without another stack, when the skill is already maxed", () => {
    const { player, session } = playerNearThreshold({ skillStacks: { [milestone.skillId]: 1 } });

    returnToHub(session, true);

    expect(player.profile.skillStacks[milestone.skillId]).toBe(1);
    expect(player.profile.earnedMilestones).toEqual([milestone.id]);
  });

  it("meets a threshold that was already passed when the milestone shipped", () => {
    const player = testPlayer("alpha", {
      profile: testProfile("alpha", { stats: { ...createMilestoneStats(), runsEscaped: 40 } }),
    });

    expect(grantMilestones(player, content)).toEqual([milestone.id]);
  });

  it("credits and grants through the same path a direct credit takes", () => {
    const { player } = playerNearThreshold();
    creditRunStats(player, { fullParty: false, bossesDefeated: false, carriedOut: 0, itemsBanked: 0 });

    expect(grantMilestones(player, content)).toEqual([milestone.id]);
  });

  it("survives a restart and does not grant again afterwards", () => {
    const storage = createMemoryProfileStorage();
    const open = () =>
      new ProfileStore({
        storage,
        now: () => 1_000,
        createProfileId: () => PROFILE_ID,
        createProfileSecret: () => "0123456789abcdef0123456789abcdef",
      });
    const store = open();
    const { profile, secret } = store.create("Grix");
    profile.stats.runsEscaped = milestone.threshold - 1;

    const session = testSession([testPlayer("alpha", { profile })], "vault-run");
    returnToHub(session, true);
    store.flush();

    const reloaded = open().find(secret)!;
    expect(reloaded.skillStacks[milestone.skillId]).toBe(1);
    expect(reloaded.earnedMilestones).toEqual([milestone.id]);
    expect(reloaded.stats.runsEscaped).toBe(milestone.threshold);

    const again = testPlayer("alpha", { profile: reloaded });
    returnToHub(testSession([again], "vault-run"), true);

    expect(reloaded.skillStacks[milestone.skillId]).toBe(1);
    expect(reloaded.stats.runsEscaped).toBe(milestone.threshold + 1);
  });
});

describe("milestone content", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function contentRoot(files: Record<string, unknown>): string {
    const root = mkdtempSync(join(tmpdir(), "dnd-milestones-"));
    roots.push(root);
    for (const [path, body] of Object.entries(files)) {
      const file = join(root, path);
      mkdirSync(join(file, ".."), { recursive: true });
      writeFileSync(file, JSON.stringify(body));
    }
    return root;
  }

  const skill = (id: string, requires: string[]) => ({
    id,
    name: id,
    description: id,
    effects: [{ type: "resistanceBonus", amount: 1 }],
    maxStacks: 1,
    conversionCoin: 1,
    requires,
  });
  const milestone = (skillId: string, fields: Record<string, unknown> = {}) => ({
    id: "first-win",
    name: "First Win",
    stat: "wins",
    threshold: 1,
    skillId,
    ...fields,
  });

  it("accepts a milestone for a skill without prerequisites", () => {
    const root = contentRoot({
      "skills/reward.json": skill("reward", []),
      "milestones/first-win.json": milestone("reward"),
    });

    expect(loadContent(root).milestones.get("first-win")).toMatchObject({ stat: "wins", threshold: 1 });
  });

  it("refuses a milestone skill that has prerequisites", () => {
    const root = contentRoot({
      "skills/base.json": skill("base", []),
      "skills/reward.json": skill("reward", ["base"]),
      "milestones/first-win.json": milestone("reward"),
    });

    expect(() => loadContent(root)).toThrow(/Milestone "first-win" grants skill "reward", which has prerequisites/);
  });

  it("refuses a milestone for an unknown skill", () => {
    const root = contentRoot({ "milestones/first-win.json": milestone("missing") });

    expect(() => loadContent(root)).toThrow(/Milestone "first-win" grants unknown skill "missing"/);
  });

  it("refuses an unknown stat and a non-positive threshold", () => {
    const base = { "skills/reward.json": skill("reward", []) };

    expect(() =>
      loadContent(contentRoot({ ...base, "milestones/m.json": milestone("reward", { stat: "bogus" }) })),
    ).toThrow(/stat/);
    expect(() =>
      loadContent(contentRoot({ ...base, "milestones/m.json": milestone("reward", { threshold: 0 }) })),
    ).toThrow(/threshold/);
  });
});
