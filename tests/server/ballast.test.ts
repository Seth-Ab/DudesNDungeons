import { describe, expect, it } from "vitest";
import { loadContent } from "../../src/server/content/loadContent.js";
import { BALLAST_ITEM_ID, lootInstance, puzzleInstance } from "../../src/server/game/dungeonBuilder.js";
import { buildDungeon, DEFAULT_DUNGEON_ID } from "../../src/server/game/dungeonState.js";
import { dropItem, pickupItem } from "../../src/server/game/items.js";
import { resolvePuzzles } from "../../src/server/game/puzzles.js";
import { returnToHub } from "../../src/server/game/runLifecycle.js";
import { BALLAST_STAMINA_COST, MAX_INVENTORY_SIZE } from "../../src/shared/constants/game.js";
import { tileOf } from "../../src/shared/game/movement.js";
import type { DungeonState, Vector2 } from "../../src/shared/types/core.js";
import { at, testPlayer, testSession } from "./fixtures.js";

const content = loadContent();
const type = content.puzzles.get("paired-levers")!;
const stone = content.items.get(BALLAST_ITEM_ID)!;
const PLATE_A = at(3, 3);
const PLATE_B = at(13, 3);
const STONE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

/** One player, two plates, and a stone lying off to the side. */
function solo() {
  const player = testPlayer("p1", { position: at(8, 8) });
  const session = testSession([player]);
  session.dungeon.monsters = [];
  session.dungeon.loot = [lootInstance(stone, at(8, 8, 0.5, 0), STONE_ID)];
  const puzzle = puzzleInstance(type, [PLATE_A, PLATE_B], "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  session.dungeon.puzzles = [puzzle];
  return { session, puzzle, player };
}

describe("Ballast Stone on a plate", () => {
  it("lets a solo player solve a two-plate puzzle by carrying the stone onto one", () => {
    const { session, puzzle, player } = solo();
    expect(pickupItem(session, player.id, STONE_ID)).toEqual({ ok: true });
    expect(player.stamina).toBe(100 - BALLAST_STAMINA_COST);

    player.position = { ...PLATE_A };
    expect(dropItem(session, player.id, STONE_ID)).toEqual({ ok: true });
    player.position = { ...PLATE_B };

    resolvePuzzles(session, 0);
    expect(puzzle.plates.map((plate) => plate.held)).toEqual([true, true]);
    resolvePuzzles(session, type.holdMs);
    expect(puzzle.phase).toBe("solved");
    expect(player.runStats.leverPuzzlesSolved).toBe(1);
  });

  it("holds nothing while it is carried, and releases the plate when it is lifted off", () => {
    const { session, puzzle, player } = solo();
    session.dungeon.loot[0]!.position = { ...PLATE_A };
    player.position = { ...PLATE_B };

    resolvePuzzles(session, 0);
    expect(puzzle.plates.map((plate) => plate.held)).toEqual([true, true]);

    player.position = { ...PLATE_A };
    expect(pickupItem(session, player.id, STONE_ID)).toEqual({ ok: true });
    resolvePuzzles(session, 100);
    expect(puzzle.plates.map((plate) => plate.held)).toEqual([true, false]);
    expect(puzzle.progress).toBe(0);
  });

  it("is lost from the plate when the carrier sets it down anywhere else", () => {
    const { session, puzzle, player } = solo();
    session.dungeon.loot[0]!.position = { ...PLATE_A };
    player.position = { ...PLATE_A };
    pickupItem(session, player.id, STONE_ID);

    player.position = at(8, 8);
    expect(dropItem(session, player.id, STONE_ID)).toEqual({ ok: true });
    player.position = { ...PLATE_B };

    resolvePuzzles(session, 0);
    resolvePuzzles(session, type.holdMs * 2);
    expect(puzzle.plates.map((plate) => plate.held)).toEqual([false, true]);
    expect(puzzle.phase).toBe("idle");
  });

  it("does not let a disconnected player hold the other plate", () => {
    const { session, puzzle, player } = solo();
    session.dungeon.loot[0]!.position = { ...PLATE_A };
    player.position = { ...PLATE_B };
    player.connected = false;

    resolvePuzzles(session, 0);
    resolvePuzzles(session, type.holdMs * 2);
    expect(puzzle.plates.map((plate) => plate.held)).toEqual([true, false]);
    expect(puzzle.phase).toBe("idle");
  });

  it("lets a stone free its neighbour: two players and a stone hold three plates", () => {
    const { session } = solo();
    const second = testPlayer("p2", { position: at(3, 9) });
    session.players.set(second.id, second);
    const plates = [PLATE_A, PLATE_B, at(8, 3)];
    const puzzle = puzzleInstance(type, plates, "dddddddd-dddd-4ddd-8ddd-dddddddddddd");
    session.dungeon.puzzles = [puzzle];
    session.dungeon.loot[0]!.position = { ...plates[1]! };
    session.players.get("p1")!.position = { ...plates[0]! };
    second.position = { ...plates[2]! };

    resolvePuzzles(session, 0);
    expect(puzzle.plates.map((plate) => plate.held)).toEqual([true, true, true]);
  });

  it("refuses an out-of-range lift, an exhausted carrier and a full pack, leaving the stone put", () => {
    const { session, player } = solo();
    const stoneLoot = session.dungeon.loot[0]!;

    player.position = at(2, 2);
    expect(pickupItem(session, player.id, STONE_ID)).toEqual({ ok: false, reason: "outOfRange" });

    player.position = at(8, 8);
    player.stamina = BALLAST_STAMINA_COST - 1;
    expect(pickupItem(session, player.id, STONE_ID)).toEqual({ ok: false, reason: "exhausted" });
    expect(player.stamina).toBe(BALLAST_STAMINA_COST - 1);

    player.stamina = 100;
    player.inventory = Array.from({ length: MAX_INVENTORY_SIZE }, (_, index) => ({
      id: `fill-${index}`,
      name: "Copper Key",
      kind: "key" as const,
      itemId: "copper-key",
    }));
    expect(pickupItem(session, player.id, STONE_ID)).toEqual({ ok: false, reason: "notPermitted" });
    expect(player.stamina).toBe(100);
    expect(stoneLoot.pickedUp).toBe(false);
  });

  it("is not banked when its carrier escapes", () => {
    const { session, player } = solo();
    pickupItem(session, player.id, STONE_ID);
    returnToHub(session, true);
    expect(session.vault.items.some((item) => item.kind === "ballast")).toBe(false);
  });
});

const SEEDS = 25;

function ballastIn(dungeon: DungeonState, room: { x: number; y: number; width: number; height: number }): number {
  return dungeon.loot.filter((loot) => {
    const tile = tileOf(loot.position);
    return (
      loot.kind === "ballast" &&
      tile.x >= room.x &&
      tile.x < room.x + room.width &&
      tile.y >= room.y &&
      tile.y < room.y + room.height
    );
  }).length;
}

describe("generation for a small party", () => {
  it("never needs more plates held than players plus stones, for parties of one to four", () => {
    let puzzles = 0;
    for (let partySize = 1; partySize <= 4; partySize += 1) {
      for (let seed = 0; seed < SEEDS; seed += 1) {
        const { dungeon } = buildDungeon({ dungeonId: DEFAULT_DUNGEON_ID, seed, content, partySize });
        for (const puzzle of dungeon.puzzles) {
          puzzles += 1;
          const tile: Vector2 = tileOf(puzzle.plates[0]!.position);
          const room = dungeon.rooms.find(
            (candidate) =>
              tile.x >= candidate.x &&
              tile.x < candidate.x + candidate.width &&
              tile.y >= candidate.y &&
              tile.y < candidate.y + candidate.height,
          )!;
          expect(puzzle.plates.length).toBeLessThanOrEqual(partySize + ballastIn(dungeon, room));
        }
      }
    }
    expect(puzzles).toBeGreaterThan(0);
  });

  it("spawns no stones for a full party and replays exactly from a seed", () => {
    const full = buildDungeon({ dungeonId: DEFAULT_DUNGEON_ID, seed: 9, content, partySize: 4 }).dungeon;
    expect(full.loot.some((loot) => loot.kind === "ballast")).toBe(false);

    const request = { dungeonId: DEFAULT_DUNGEON_ID, seed: 9, content, partySize: 1 };
    expect(buildDungeon(request).dungeon).toEqual(buildDungeon(request).dungeon);
  });
});
