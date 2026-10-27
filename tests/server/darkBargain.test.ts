import { describe, expect, it } from "vitest";
import { simulate } from "../../src/server/game/combat.js";
import { monsterStatsFor } from "../../src/server/game/dungeonState.js";
import { pickupItem } from "../../src/server/game/items.js";
import { MonsterPlanner } from "../../src/server/game/monsterAi.js";
import { advanceDarkBargains, darkBargainFor } from "../../src/server/game/darkBargain.js";
import { buildDungeon } from "../../src/server/game/dungeonState.js";
import { lootRngFor } from "../../src/server/game/monsterLoot.js";
import { lightTorch, putOutTorch } from "../../src/server/game/torches.js";
import { captureRun, restoreRun } from "../../src/server/saves/roomSave.js";
import type { Session, SessionPlayer } from "../../src/server/sessions/sessionStore.js";
import { DARK_BARGAIN_MS, DARK_BARGAIN_WAVE_PER_PLAYER } from "../../src/shared/constants/game.js";
import { distance, isFloor } from "../../src/shared/game/movement.js";
import { roomAt } from "../../src/shared/game/rooms.js";
import { testPlayer, testSession } from "./fixtures.js";

const NAMES = ["alpha", "bravo", "charlie"];

/** A generated `vault-run` with a shrine in it, everyone standing on the shrine's floor, torches out. */
function shrineRun(names = NAMES): { session: Session; players: SessionPlayer[]; shrineId: string } {
  for (let seed = 1; seed < 400; seed += 1) {
    const request = { dungeonId: "vault-run", seed, partySize: names.length };
    const built = buildDungeon(request);
    const shrine = built.dungeon.rooms.find((room) => room.kind === "shrine");
    if (!shrine) continue;

    const players = names.map((name) => testPlayer(name));
    const session = testSession(players, "vault-run");
    session.dungeon = built.dungeon;
    session.runDungeon = request;
    session.lootRng = lootRngFor(built.seed, "vault-run");
    const centre = { x: Math.round(shrine.x + shrine.width / 2), y: Math.round(shrine.y + shrine.height / 2) };
    players.forEach((player, index) => {
      player.enteredDungeonAt = 0;
      player.position = { x: centre.x + index, y: centre.y + 1 };
      expect(isFloor(session.dungeon, player.position)).toBe(true);
      player.torchLit = false;
    });
    return { session, players, shrineId: shrine.id };
  }
  throw new Error("No seed in range generated a shrine");
}

const chestsIn = (session: Session, shrineId: string) => {
  const shrine = session.dungeon.rooms.find((room) => room.id === shrineId)!;
  return session.dungeon.chests.filter((chest) => roomAt([shrine], chest.position) !== null);
};

describe("Dark Bargain", () => {
  it("gives every shrine one common chest", () => {
    const { session, shrineId } = shrineRun();
    const chests = chestsIn(session, shrineId);
    expect(chests).toHaveLength(1);
    expect(chests[0]).toMatchObject({ lootTableId: "common-chest", opened: false, mimic: false });
  });

  it("counts down while every torch is out and strikes after 20 s: richer chests and a hunting wave", () => {
    const { session, players, shrineId } = shrineRun();
    const before = session.dungeon.monsters.length;
    advanceDarkBargains(session, 1000);
    expect(darkBargainFor(session, players[0]!)).toMatchObject({ status: "counting", remainingMs: DARK_BARGAIN_MS });

    advanceDarkBargains(session, 1000 + DARK_BARGAIN_MS - 1);
    expect(session.darkBargains.get(shrineId)?.status).toBe("counting");
    expect(chestsIn(session, shrineId)[0]!.lootTableId).toBe("common-chest");

    advanceDarkBargains(session, 1000 + DARK_BARGAIN_MS);
    expect(session.darkBargains.get(shrineId)?.status).toBe("struck");
    expect(chestsIn(session, shrineId)[0]!.lootTableId).toBe("vault-chest");

    const wave = session.dungeon.monsters.slice(before);
    expect(wave).toHaveLength(NAMES.length * DARK_BARGAIN_WAVE_PER_PLAYER);
    for (const monster of wave) expect(session.monsterPosts.get(monster.id)?.engaged).toBe(true);
  });

  it("strikes once: a later tick sends no second wave", () => {
    const { session } = shrineRun();
    advanceDarkBargains(session, 0);
    advanceDarkBargains(session, DARK_BARGAIN_MS);
    const count = session.dungeon.monsters.length;
    advanceDarkBargains(session, DARK_BARGAIN_MS * 3);
    expect(session.dungeon.monsters).toHaveLength(count);
  });

  it("does not improve a chest that was already opened", () => {
    const { session, shrineId } = shrineRun();
    chestsIn(session, shrineId)[0]!.opened = true;
    advanceDarkBargains(session, 0);
    advanceDarkBargains(session, DARK_BARGAIN_MS);
    expect(chestsIn(session, shrineId)[0]!.lootTableId).toBe("common-chest");
  });

  it("is broken by relighting a torch from the candle, and the reward is lost", () => {
    const { session, players, shrineId } = shrineRun();
    const candle = session.dungeon.lightSources.find((light) => light.fixture === "candle")!;
    advanceDarkBargains(session, 0);
    players[0]!.position = { ...candle.position };
    expect(lightTorch(session, players[0]!.id)).toEqual({ ok: true });
    expect(session.darkBargains.get(shrineId)?.status).toBe("broken");

    putOutTorch(session, players[0]!.id);
    advanceDarkBargains(session, DARK_BARGAIN_MS * 2);
    expect(chestsIn(session, shrineId)[0]!.lootTableId).toBe("common-chest");
    expect(darkBargainFor(session, players[1]!)?.status).toBe("broken");
  });

  it("is broken by relighting from another player's torch", () => {
    const { session, players, shrineId } = shrineRun();
    advanceDarkBargains(session, 0);
    players[1]!.torchLit = true;
    players[0]!.position = { ...players[1]!.position };
    expect(lightTorch(session, players[0]!.id)).toEqual({ ok: true });
    expect(session.darkBargains.get(shrineId)?.status).toBe("broken");
  });

  it("is broken when a lit torch walks in, a late joiner's included", () => {
    const { session, players, shrineId } = shrineRun(["alpha", "bravo"]);
    const joiner = testPlayer("late");
    joiner.enteredDungeonAt = 0;
    joiner.position = { x: 1, y: 1 };
    session.players.set(joiner.id, joiner);

    advanceDarkBargains(session, 0);
    advanceDarkBargains(session, 5000);
    expect(session.darkBargains.get(shrineId)?.status).toBe("counting");

    joiner.position = { ...players[0]!.position };
    advanceDarkBargains(session, 6000);
    expect(session.darkBargains.get(shrineId)?.status).toBe("broken");
  });

  it("is not broken by a late joiner whose torch is out", () => {
    const { session, players, shrineId } = shrineRun(["alpha", "bravo"]);
    const joiner = testPlayer("late", { torchLit: false });
    joiner.enteredDungeonAt = 0;
    joiner.position = { ...players[0]!.position };
    advanceDarkBargains(session, 0);
    session.players.set(joiner.id, joiner);
    advanceDarkBargains(session, DARK_BARGAIN_MS);
    expect(session.darkBargains.get(shrineId)?.status).toBe("struck");
  });

  it("ignores a lit torch outside the room", () => {
    const { session, players, shrineId } = shrineRun(["alpha", "bravo"]);
    players[1]!.position = { x: 1, y: 1 };
    players[1]!.torchLit = true;
    advanceDarkBargains(session, 0);
    advanceDarkBargains(session, DARK_BARGAIN_MS);
    expect(session.darkBargains.get(shrineId)?.status).toBe("struck");
  });

  it("starts over when the only player in the room disconnects, and does not count their torch", () => {
    const { session, players, shrineId } = shrineRun(["alpha"]);
    advanceDarkBargains(session, 0);
    advanceDarkBargains(session, 10_000);
    players[0]!.connected = false;
    players[0]!.torchLit = true;
    advanceDarkBargains(session, 11_000);
    expect(session.darkBargains.has(shrineId)).toBe(false);

    players[0]!.connected = true;
    players[0]!.torchLit = false;
    advanceDarkBargains(session, 12_000);
    advanceDarkBargains(session, 12_000 + DARK_BARGAIN_MS - 1);
    expect(session.darkBargains.get(shrineId)?.status).toBe("counting");
  });

  it("still strikes when a disconnect leaves the others in the dark", () => {
    const { session, players, shrineId } = shrineRun();
    advanceDarkBargains(session, 0);
    players[2]!.connected = false;
    advanceDarkBargains(session, DARK_BARGAIN_MS);
    expect(session.darkBargains.get(shrineId)?.status).toBe("struck");
  });

  it("lets a downed player in the dark neither count nor block, but a downed burning torch breaks it", () => {
    const dark = shrineRun();
    dark.players[2]!.health = 0;
    advanceDarkBargains(dark.session, 0);
    advanceDarkBargains(dark.session, DARK_BARGAIN_MS);
    expect(dark.session.darkBargains.get(dark.shrineId)?.status).toBe("struck");

    const burning = shrineRun();
    advanceDarkBargains(burning.session, 0);
    burning.players[2]!.health = 0;
    burning.players[2]!.torchLit = true;
    advanceDarkBargains(burning.session, 1000);
    expect(burning.session.darkBargains.get(burning.shrineId)?.status).toBe("broken");
  });

  it("does not run for a party that is all downed", () => {
    const { session, players, shrineId } = shrineRun();
    for (const player of players) player.health = 0;
    advanceDarkBargains(session, 0);
    expect(session.darkBargains.has(shrineId)).toBe(false);
  });

  it("is advanced by the combat tick, and the wave hunts", () => {
    const { session, players } = shrineRun();
    simulate(session, 0);
    simulate(session, DARK_BARGAIN_MS + 50);
    const posts = [...session.monsterPosts.values()].filter((post) => post.engaged);
    expect(posts.length).toBeGreaterThanOrEqual(players.length);
  });

  it("sends a wave that hunts the party even from beyond its ordinary aggro range", () => {
    const { session, players } = shrineRun();
    const known = new Set(session.dungeon.monsters.map((monster) => monster.id));
    advanceDarkBargains(session, 0);
    advanceDarkBargains(session, DARK_BARGAIN_MS);
    const wave = session.dungeon.monsters.filter((monster) => !known.has(monster.id));
    expect(wave.length).toBeGreaterThan(0);

    // Stand the party just past the wave's own aggro range, still in sight of it.
    const hunter = wave[0]!;
    const stats = monsterStatsFor(hunter);
    const spot = [...Array(session.dungeon.map.height).keys()]
      .flatMap((y) => [...Array(session.dungeon.map.width).keys()].map((x) => ({ x: x + 0.5, y: y + 0.5 })))
      .find((tile) => {
        const gap = distance(hunter.position, tile);
        return isFloor(session.dungeon, tile) && gap > stats.aggroRange + 0.5 && gap < stats.aggroRange * 1.8;
      });
    expect(spot).toBeDefined();
    for (const player of players) player.position = { ...spot! };

    const planner = new MonsterPlanner(session);
    expect(planner.target(hunter, stats, DARK_BARGAIN_MS)).toBeDefined();
  });

  it("sizes the wave by standing players, not downed ones", () => {
    const standing = shrineRun();
    const known = new Set(standing.session.dungeon.monsters.map((monster) => monster.id));
    advanceDarkBargains(standing.session, 0);
    advanceDarkBargains(standing.session, DARK_BARGAIN_MS);
    const full = standing.session.dungeon.monsters.filter((monster) => !known.has(monster.id)).length;

    const downed = shrineRun();
    downed.players[2]!.health = 0;
    const knownDowned = new Set(downed.session.dungeon.monsters.map((monster) => monster.id));
    advanceDarkBargains(downed.session, 0);
    advanceDarkBargains(downed.session, DARK_BARGAIN_MS);
    const fewer = downed.session.dungeon.monsters.filter((monster) => !knownDowned.has(monster.id)).length;

    expect(full).toBe(3 * DARK_BARGAIN_WAVE_PER_PLAYER);
    expect(fewer).toBe(2 * DARK_BARGAIN_WAVE_PER_PLAYER);
  });

  it("is broken by picking up a torch in the room, even if it is put out again at once", () => {
    const { session, players, shrineId } = shrineRun();
    players[2]!.carryingTorch = false;
    players[2]!.torchLit = false;
    session.dungeon.loot.push({
      id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      name: "Torch",
      kind: "torch",
      position: { ...players[2]!.position },
      pickedUp: false,
    });
    advanceDarkBargains(session, 0);
    expect(session.darkBargains.get(shrineId)?.status).toBe("counting");

    expect(pickupItem(session, players[2]!.id, "ffffffff-ffff-4fff-8fff-ffffffffffff")).toEqual({ ok: true });
    expect(putOutTorch(session, players[2]!.id)).toEqual({ ok: true });
    advanceDarkBargains(session, 1000);
    expect(session.darkBargains.get(shrineId)?.status).toBe("broken");
  });

  it("keeps a settled bargain across a save", () => {
    const { session, shrineId } = shrineRun();
    advanceDarkBargains(session, 0);
    advanceDarkBargains(session, DARK_BARGAIN_MS);
    const saved = captureRun(session, 100, "test");
    expect(saved.darkBargains).toEqual({ [shrineId]: "struck" });

    session.darkBargains.clear();
    restoreRun(session, saved, 100);
    expect(session.darkBargains.get(shrineId)?.status).toBe("struck");
  });
});
