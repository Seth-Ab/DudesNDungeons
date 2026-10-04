import { describe, expect, it } from "vitest";
import { gameContent } from "../../src/server/content/loadContent.js";
import { puzzleInstance } from "../../src/server/game/dungeonBuilder.js";
import { movePlayer } from "../../src/server/game/dungeonState.js";
import { simulate } from "../../src/server/game/combat.js";
import { requiredHoldMs, resolvePuzzles } from "../../src/server/game/puzzles.js";
import { returnToHub } from "../../src/server/game/runLifecycle.js";
import { visibilityFrameForPlayer } from "../../src/server/game/visibility.js";
import { puzzleStateSchema } from "../../src/shared/types/core.js";
import { at, testPlayer, testProfile, testSession } from "./fixtures.js";

const content = gameContent();
const type = content.puzzles.get("paired-levers")!;
const PUZZLE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PLATE_A = at(3, 3);
const PLATE_B = at(13, 3);

/** Two players, one puzzle with plates at opposite ends of the Ember Vault's floor. */
function withPuzzle(extraPlayers = 0) {
  const players = [
    testPlayer("p1", { position: at(2, 2) }),
    testPlayer("p2", { position: at(2, 4) }),
    ...Array.from({ length: extraPlayers }, (_, index) =>
      testPlayer(`x${index}`, { position: at(2, 5 + index) }),
    ),
  ];
  const session = testSession(players);
  session.dungeon.monsters = [];
  session.dungeon.loot = [];
  const puzzle = puzzleInstance(type, [PLATE_A, PLATE_B], PUZZLE_ID);
  session.dungeon.puzzles = [puzzle];
  return { session, puzzle, p1: players[0]!, p2: players[1]! };
}

describe("cooperative puzzle resolution", () => {
  it("is solved when two players hold both plates for the whole hold time", () => {
    const { session, puzzle, p1, p2 } = withPuzzle();
    p1.position = { ...PLATE_A };
    p2.position = { ...PLATE_B };

    expect(resolvePuzzles(session, 1000)).toEqual([]);
    expect(puzzle.plates.map((plate) => plate.held)).toEqual([true, true]);
    expect(puzzle.progress).toBe(0);

    resolvePuzzles(session, 1000 + type.holdMs / 2);
    expect(puzzle.progress).toBeCloseTo(0.5);
    expect(puzzle.phase).toBe("idle");

    const solved = resolvePuzzles(session, 1000 + type.holdMs);
    expect(solved.map((entry) => entry.id)).toEqual([PUZZLE_ID]);
    expect(puzzle.phase).toBe("solved");
    expect(puzzle.progress).toBe(1);
  });

  it("pays an authoritative reward on the first plate and only once", () => {
    const { session, p1, p2 } = withPuzzle();
    p1.position = { ...PLATE_A };
    p2.position = { ...PLATE_B };

    resolvePuzzles(session, 0);
    resolvePuzzles(session, type.holdMs);
    resolvePuzzles(session, type.holdMs + 5000);

    expect(session.dungeon.loot).toHaveLength(1);
    expect(session.dungeon.loot[0]).toMatchObject({
      kind: "key",
      pickedUp: false,
      position: PLATE_A,
    });
  });

  it("is not solved by one player, who cannot hold two plates", () => {
    const { session, puzzle, p1 } = withPuzzle();
    // Both plates within reach of one person standing between them.
    const close = puzzleInstance(type, [at(3, 3), at(3, 3, 1, 0)], PUZZLE_ID);
    session.dungeon.puzzles = [close];
    p1.position = at(3, 3, 0.5, 0);

    resolvePuzzles(session, 0);
    resolvePuzzles(session, 60_000);

    expect(close.phase).toBe("idle");
    expect(close.plates.filter((plate) => plate.held)).toHaveLength(1);
    expect(session.dungeon.loot).toHaveLength(0);
    expect(puzzle.phase).toBe("idle");
  });

  it("does not count a second player who is not on a plate", () => {
    const { session, puzzle, p1 } = withPuzzle();
    p1.position = { ...PLATE_A };

    resolvePuzzles(session, 0);
    resolvePuzzles(session, 60_000);

    expect(puzzle.phase).toBe("idle");
    expect(puzzle.plates.map((plate) => plate.held)).toEqual([true, false]);
  });

  it("resets the hold the moment a player steps away", () => {
    const { session, puzzle, p1, p2 } = withPuzzle();
    p1.position = { ...PLATE_A };
    p2.position = { ...PLATE_B };
    resolvePuzzles(session, 0);
    resolvePuzzles(session, type.holdMs - 1);
    expect(puzzle.progress).toBeGreaterThan(0.9);

    p2.position = at(2, 4);
    resolvePuzzles(session, type.holdMs);
    expect(puzzle.progress).toBe(0);
    expect(session.puzzleHeldSince.size).toBe(0);

    // Coming back starts from zero, not from where it was.
    p2.position = { ...PLATE_B };
    resolvePuzzles(session, type.holdMs + 100);
    resolvePuzzles(session, type.holdMs + 200);
    expect(puzzle.phase).toBe("idle");
    expect(puzzle.progress).toBeLessThan(0.1);
  });

  it("resets when a holder is incapacitated", () => {
    const { session, puzzle, p1, p2 } = withPuzzle();
    p1.position = { ...PLATE_A };
    p2.position = { ...PLATE_B };
    resolvePuzzles(session, 0);
    resolvePuzzles(session, type.holdMs / 2);

    p2.health = 0;
    resolvePuzzles(session, type.holdMs / 2 + 1);

    expect(puzzle.plates[1]?.held).toBe(false);
    expect(puzzle.progress).toBe(0);
    resolvePuzzles(session, type.holdMs * 3);
    expect(puzzle.phase).toBe("idle");
  });

  it("resets when a holder disconnects, and a downed body cannot hold a plate", () => {
    const { session, puzzle, p1, p2 } = withPuzzle();
    p1.position = { ...PLATE_A };
    p2.position = { ...PLATE_B };
    resolvePuzzles(session, 0);

    p1.connected = false;
    resolvePuzzles(session, 100);
    expect(puzzle.progress).toBe(0);
    expect(puzzle.plates[0]?.held).toBe(false);

    p1.connected = true;
    p1.health = 0;
    resolvePuzzles(session, 200);
    expect(puzzle.plates[0]?.held).toBe(false);
    expect(puzzle.phase).toBe("idle");
  });

  it("keeps the same result for the same positions regardless of tick spacing", () => {
    const fast = withPuzzle();
    const slow = withPuzzle();
    for (const world of [fast, slow]) {
      world.p1.position = { ...PLATE_A };
      world.p2.position = { ...PLATE_B };
    }
    for (let now = 0; now <= type.holdMs; now += 100) resolvePuzzles(fast.session, now);
    resolvePuzzles(slow.session, 0);
    resolvePuzzles(slow.session, type.holdMs);

    expect(fast.puzzle.phase).toBe("solved");
    expect(slow.puzzle.phase).toBe("solved");
  });

  it("resolves on the simulation tick and after a move", () => {
    const { session, puzzle, p1, p2 } = withPuzzle();
    p1.position = { ...PLATE_A };
    p2.position = { x: PLATE_B.x - type.plateRadius - 0.3, y: PLATE_B.y };
    simulate(session, 0);
    expect(puzzle.plates[0]?.held).toBe(true);
    expect(puzzle.plates[1]?.held).toBe(false);

    expect(movePlayer(session, "p2", { x: 1, y: 0 }, 0).ok).toBe(true);
    resolvePuzzles(session, 0);
    expect(puzzle.plates[1]?.held).toBe(true);
  });

  it("does nothing in the hub and rebuilds clean after a run", () => {
    const { session, puzzle, p1, p2 } = withPuzzle();
    p1.position = { ...PLATE_A };
    p2.position = { ...PLATE_B };
    resolvePuzzles(session, 0);
    expect(session.puzzleHeldSince.size).toBe(1);

    returnToHub(session, true);
    expect(session.puzzleHeldSince.size).toBe(0);
    expect(session.dungeon.puzzles).toEqual([]);

    session.dungeon.puzzles = [puzzle];
    expect(resolvePuzzles(session, 10_000)).toEqual([]);
  });
});

describe("puzzle power", () => {
  it("shortens the hold by the summed bonus of the holders, down to the floor", () => {
    expect(requiredHoldMs(type, 0)).toBe(type.holdMs);
    expect(requiredHoldMs(type, 2)).toBe(type.holdMs - 2 * type.holdReductionMsPerPower);
    expect(requiredHoldMs(type, 100)).toBe(type.minHoldMs);
  });

  it("solves sooner when holders have puzzle power", () => {
    const plain = withPuzzle();
    const skilled = withPuzzle();
    for (const world of [plain, skilled]) {
      world.p1.position = { ...PLATE_A };
      world.p2.position = { ...PLATE_B };
    }
    skilled.p1.profile = testProfile("p1", { unlockedSkillIds: ["lever-sense"] });
    skilled.p2.runSkillIds = new Set(["lever-sense"]);

    const early = type.holdMs - 2 * type.holdReductionMsPerPower;
    for (const world of [plain, skilled]) {
      resolvePuzzles(world.session, 0);
      resolvePuzzles(world.session, early);
    }

    expect(plain.puzzle.phase).toBe("idle");
    expect(skilled.puzzle.phase).toBe("solved");
  });

  it("ignores the bonus of players who are not holding a plate", () => {
    const { session, puzzle, p1, p2 } = withPuzzle(1);
    const bystander = session.players.get("x0")!;
    bystander.runSkillIds = new Set(["lever-sense"]);
    p1.position = { ...PLATE_A };
    p2.position = { ...PLATE_B };

    resolvePuzzles(session, 0);
    resolvePuzzles(session, type.holdMs - type.holdReductionMsPerPower);

    expect(puzzle.phase).toBe("idle");
  });
});

describe("puzzle visibility", () => {
  it("sends only the plates the viewer can see, and nothing when none are in view", () => {
    const { session, puzzle, p1 } = withPuzzle();
    session.dungeon.lightSources = [];
    p1.position = { ...PLATE_A };

    const seen = visibilityFrameForPlayer(session, p1).dungeon.puzzles;
    expect(seen).toHaveLength(1);
    expect(seen[0]?.plates).toHaveLength(1);
    expect(seen[0]?.plates[0]?.position).toEqual(PLATE_A);
    expect(puzzleStateSchema.safeParse(seen[0]).success).toBe(true);
    expect(puzzle.plates).toHaveLength(2);

    p1.carryingTorch = false;
    p1.position = at(14, 6);
    expect(visibilityFrameForPlayer(session, p1).dungeon.puzzles).toEqual([]);
  });

  it("reports held plates and progress to a viewer", () => {
    const { session, p1, p2 } = withPuzzle();
    session.dungeon.lightSources = [];
    p1.position = { ...PLATE_A };
    p2.position = { x: PLATE_A.x + 1, y: PLATE_A.y };
    resolvePuzzles(session, 0);

    const seen = visibilityFrameForPlayer(session, p1).dungeon.puzzles[0];
    expect(seen?.plates[0]?.held).toBe(true);
    expect(seen?.phase).toBe("idle");
  });
});
