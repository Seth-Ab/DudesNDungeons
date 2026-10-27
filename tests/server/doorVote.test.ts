import { describe, expect, it } from "vitest";
import { gameContent } from "../../src/server/content/loadContent.js";
import type { DelveDungeon } from "../../src/server/content/schema.js";
import { doorVoteInstance } from "../../src/server/game/dungeonBuilder.js";
import { generateDungeon } from "../../src/server/game/dungeonGenerator.js";
import { DEFAULT_DUNGEON_ID } from "../../src/server/game/dungeonState.js";
import { validateDungeon } from "../../src/server/game/generation/validate.js";
import { interact } from "../../src/server/game/items.js";
import { resolvePuzzles } from "../../src/server/game/puzzles.js";
import { returnToHub } from "../../src/server/game/runLifecycle.js";
import { visibilityFrameForPlayer } from "../../src/server/game/visibility.js";
import { DOOR_VOTE_ICONS } from "../../src/shared/constants/game.js";
import { doorStateSchema, puzzleStateSchema } from "../../src/shared/types/core.js";
import { at, testPlayer, testSession } from "./fixtures.js";
import { captureRun, persistedRunSchema, restoreRun } from "../../src/server/saves/roomSave.js";

const content = gameContent();
const type = content.puzzles.get("door-vote")!;
const profile = content.dungeons.get(DEFAULT_DUNGEON_ID) as DelveDungeon;
const VOTE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const LEFT_DOOR = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const RIGHT_DOOR = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

/** Seeds that build a run holding a vote, for a party of the size, found by running the generator. */
function voteRuns(partySize: number, wanted: number) {
  const runs = [];
  for (let seed = 0; runs.length < wanted && seed < 400; seed += 1) {
    const built = generateDungeon(profile, content, seed, partySize, { vote: true });
    if (built.dungeon.puzzles.some((puzzle) => puzzle.heldBy === "doors")) runs.push({ seed, built });
  }
  return runs;
}

describe("Door Vote generation", () => {
  it("never appears for a party of one, which has nobody to vote with", () => {
    for (let seed = 0; seed < 120; seed += 1) {
      const built = generateDungeon(profile, content, seed, 1, { vote: true });
      expect(built.dungeon.puzzles.some((puzzle) => puzzle.heldBy === "doors"), `seed ${seed}`).toBe(false);
      expect(built.dungeon.doors.some((door) => door.lock?.type === "seal"), `seed ${seed}`).toBe(false);
    }
  });

  it.each([2, 3, 4])("is solvable and valid for a party of %i whichever door is picked", (partySize) => {
    const runs = voteRuns(partySize, 25);
    // Few layouts hold a junction, but a run that wants a vote holds out for one.
    expect(runs.length).toBeGreaterThanOrEqual(20);

    for (const { seed, built } of runs) {
      expect(validateDungeon(built, content, partySize), `seed ${seed}`).toEqual([]);
      const vote = built.dungeon.puzzles.find((puzzle) => puzzle.heldBy === "doors")!;
      const doorIds = [...new Set(vote.plates.map((plate) => plate.doorId))];
      expect(doorIds.length, `seed ${seed}`).toBeGreaterThanOrEqual(2);
      for (const doorId of doorIds) {
        const door = built.dungeon.doors.find((candidate) => candidate.id === doorId)!;
        expect(door.lock, `seed ${seed}`).toEqual({ type: "seal", groupId: "door-vote" });
        const plates = vote.plates.filter((plate) => plate.doorId === doorId);
        // A plate for every player, so the whole party can stand on one door's plates at once.
        expect(plates, `seed ${seed}`).toHaveLength(partySize);
        expect(DOOR_VOTE_ICONS).toContain(plates[0]!.icon);
        expect(new Set(plates.map((plate) => plate.icon)).size).toBe(1);
      }
    }
  });

  it("is refused by validation when a sealed door stands in the way on, or a door has too few plates", () => {
    const built = voteRuns(3, 1)[0]!.built;
    const clone = <T>(value: T): T => structuredClone(value);

    // The boss door sealed for good: no choice leads on, so the run cannot be finished.
    const stuck = clone(built);
    const bossDoor = stuck.dungeon.doors.find((door) => door.lock?.type === "key")!;
    bossDoor.lock = { type: "seal", groupId: "door-vote" };
    expect(validateDungeon(stuck, content, 3)).toContain("the exit is unreachable after every key and puzzle");

    // A vote that does not fit the party.
    const short = clone(built);
    const plates = short.dungeon.puzzles.find((puzzle) => puzzle.heldBy === "doors")!.plates;
    plates.splice(0, 1);
    expect(validateDungeon(short, content, 3).join("\n")).toMatch(/plates for 3 players/);
    expect(validateDungeon(built, content, 1).join("\n")).toMatch(/needs a bigger party/);

    // A single door is not a vote.
    const single = clone(built);
    const vote = single.dungeon.puzzles.find((puzzle) => puzzle.heldBy === "doors")!;
    vote.plates = vote.plates.filter((plate) => plate.doorId === vote.plates[0]!.doorId);
    expect(validateDungeon(single, content, 3).join("\n")).toMatch(/two or more sealed doors/);
  });
});

/** A room with two voted doors, a row of three plates before each, and `count` players. */
function withVote(count: number) {
  const players = Array.from({ length: count }, (_, index) => testPlayer(`p${index}`, { position: at(2, 2 + index) }));
  const session = testSession(players);
  session.dungeon.monsters = [];
  session.dungeon.loot = [];
  const leftPlates = [at(3, 3), at(3, 4), at(3, 5)];
  const rightPlates = [at(13, 3), at(13, 4), at(13, 5)];
  const vote = doorVoteInstance(
    type,
    [
      { doorId: LEFT_DOOR, icon: "loot", plates: leftPlates },
      { doorId: RIGHT_DOOR, icon: "danger", plates: rightPlates },
    ],
    VOTE_ID,
  );
  session.dungeon.puzzles = [vote];
  session.dungeon.doors = [
    { id: LEFT_DOOR, position: at(1, 4), size: 1, open: false, lock: { type: "seal", groupId: "door-vote" } },
    { id: RIGHT_DOOR, position: at(15, 4), size: 1, open: false, lock: { type: "seal", groupId: "door-vote" } },
  ];
  const stand = (plates: typeof leftPlates) => players.forEach((player, index) => (player.position = { ...plates[index]! }));
  return { session, vote, players, leftPlates, rightPlates, stand };
}

const doorOf = (session: ReturnType<typeof withVote>["session"], id: string) =>
  session.dungeon.doors.find((door) => door.id === id)!;

describe("Door Vote resolution", () => {
  it("opens the door the whole party holds, and leaves the others sealed for good", () => {
    const { session, vote, leftPlates, stand } = withVote(3);
    stand(leftPlates);

    expect(resolvePuzzles(session, 1000)).toEqual([]);
    expect(vote.plates.slice(0, 3).map((plate) => plate.held)).toEqual([true, true, true]);
    expect(vote.plates.slice(3).map((plate) => plate.held)).toEqual([false, false, false]);
    resolvePuzzles(session, 1000 + type.holdMs / 2);
    expect(vote.progress).toBeCloseTo(0.5);
    expect(doorOf(session, LEFT_DOOR).open).toBe(false);

    const solved = resolvePuzzles(session, 1000 + type.holdMs);
    expect(solved.map((entry) => entry.id)).toEqual([VOTE_ID]);
    expect(vote.phase).toBe("solved");
    expect(doorOf(session, LEFT_DOOR)).toMatchObject({ open: true, lock: null });
    expect(doorOf(session, RIGHT_DOOR)).toMatchObject({ open: false, lock: { type: "seal" } });

    // Changing their minds afterwards changes nothing: the vote is over.
    const [p0, p1, p2] = [...session.players.values()];
    [p0, p1, p2].forEach((player, index) => (player!.position = { ...withVote(3).rightPlates[index]! }));
    resolvePuzzles(session, 20_000);
    resolvePuzzles(session, 30_000);
    expect(doorOf(session, RIGHT_DOOR).open).toBe(false);
  });

  it("resets when anyone steps off, and when the party splits between doors", () => {
    const { session, vote, players, leftPlates, rightPlates, stand } = withVote(3);
    stand(leftPlates);
    resolvePuzzles(session, 0);
    resolvePuzzles(session, type.holdMs - 100);
    expect(vote.progress).toBeGreaterThan(0.9);

    players[2]!.position = at(8, 8);
    resolvePuzzles(session, type.holdMs);
    expect(vote.progress).toBe(0);

    // One at the other door: nobody has a door to themselves, so nothing is picked.
    players[2]!.position = { ...rightPlates[0]! };
    resolvePuzzles(session, type.holdMs + 100);
    resolvePuzzles(session, type.holdMs * 3);
    expect(vote.phase).toBe("idle");
    expect(vote.progress).toBe(0);

    // Standing back together starts a fresh hold rather than resuming the old one.
    players[2]!.position = { ...leftPlates[2]! };
    resolvePuzzles(session, type.holdMs * 4);
    expect(vote.progress).toBe(0);
    resolvePuzzles(session, type.holdMs * 5);
    expect(vote.phase).toBe("solved");
  });

  it("is not carried by a Ballast Stone, which casts no vote", () => {
    const { session, vote, players, leftPlates, stand } = withVote(3);
    stand(leftPlates);
    players[2]!.position = at(8, 8);
    session.dungeon.loot.push({
      id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      name: "Ballast Stone",
      kind: "ballast",
      position: { ...leftPlates[2]! },
      pickedUp: false,
    });
    resolvePuzzles(session, 0);
    resolvePuzzles(session, type.holdMs * 2);
    expect(vote.plates[2]!.held).toBe(false);
    expect(vote.phase).toBe("idle");
  });

  it("carries on without a player who disconnects, and without one who is down", () => {
    const { session, vote, players, leftPlates, stand } = withVote(3);
    stand(leftPlates);
    players[2]!.connected = false;
    resolvePuzzles(session, 0);
    expect(vote.plates.map((plate) => plate.held).slice(0, 3)).toEqual([true, true, false]);
    resolvePuzzles(session, type.holdMs);
    expect(vote.phase).toBe("solved");
    expect(doorOf(session, LEFT_DOOR).open).toBe(true);

    const second = withVote(3);
    second.stand(second.rightPlates);
    second.players[0]!.health = 0;
    resolvePuzzles(second.session, 0);
    // The one who is down holds nothing, even standing on a plate.
    expect(second.vote.plates.filter((plate) => plate.held)).toHaveLength(2);
    resolvePuzzles(second.session, type.holdMs);
    expect(doorOf(second.session, RIGHT_DOOR).open).toBe(true);
  });

  it("does not open for a lone straggler when the party has not all joined them", () => {
    const { session, vote, players, leftPlates } = withVote(3);
    players[0]!.position = { ...leftPlates[0]! };
    resolvePuzzles(session, 0);
    resolvePuzzles(session, type.holdMs * 2);
    expect(vote.phase).toBe("idle");
  });

  it("refuses to open a sealed door by interacting with it", () => {
    const { session, players } = withVote(2);
    players[0]!.position = at(1, 4, 1, 0);
    expect(interact(session, "p0", LEFT_DOOR)).toEqual({ ok: false, reason: "notPermitted" });
    expect(doorOf(session, LEFT_DOOR).open).toBe(false);
    // Nor can a door that does not exist.
    expect(interact(session, "p0", "00000000-0000-4000-8000-000000000000")).toMatchObject({ ok: false });
  });

  it("drops every hold when the party returns to the hub", () => {
    const { session, leftPlates, stand } = withVote(2);
    stand(leftPlates);
    resolvePuzzles(session, 0);
    expect(session.puzzleHeldSince.size).toBe(1);

    returnToHub(session, true);
    expect(session.puzzleHeldSince.size).toBe(0);
    expect(session.dungeon.puzzles).toEqual([]);
  });

  it("sends each plate's door and icon to a viewer, and the schema accepts them", () => {
    const { session, vote, players, leftPlates } = withVote(2);
    session.dungeon.lightSources = [];
    players[0]!.position = { ...leftPlates[0]! };

    const seen = visibilityFrameForPlayer(session, players[0]!).dungeon.puzzles;
    expect(seen).toHaveLength(1);
    expect(seen[0]!.heldBy).toBe("doors");
    expect(seen[0]!.plates.every((plate) => plate.doorId === LEFT_DOOR && plate.icon === "loot")).toBe(true);
    expect(puzzleStateSchema.safeParse(seen[0]).success).toBe(true);
    expect(vote.plates.map((plate) => plate.icon)).toEqual(["loot", "loot", "loot", "danger", "danger", "danger"]);
  });
});

describe("Door Vote validation of required things", () => {
  it("refuses a run whose key-carrying elite stands in a branch only some votes reach", () => {
    let refused = 0;
    for (const { built } of voteRuns(3, 10)) {
      expect(validateDungeon(built, content, 3)).toEqual([]);
      const elite = built.dungeon.monsters.find((monster) => monster.elite);
      if (!elite) continue;
      for (const room of built.dungeon.rooms) {
        const moved = structuredClone(built);
        const monster = moved.dungeon.monsters.find((candidate) => candidate.id === elite.id)!;
        monster.position = { x: room.x + Math.floor(room.width / 2), y: room.y + Math.floor(room.height / 2) };
        if (validateDungeon(moved, content, 3).some((error) => /elite .* unreachable after a vote/.test(error))) refused += 1;
      }
    }
    // Some room lies behind a single voted door, and an elite put there is no longer in every choice.
    expect(refused).toBeGreaterThan(0);
  });
});

describe("Door Vote hints", () => {
  it("keeps a sealed door's hint when its plates are out of view", () => {
    const { session, players } = withVote(2);
    session.dungeon.lightSources = [];
    players[0]!.position = at(8, 12);
    const { map } = session.dungeon;
    players[0]!.discoveredTiles = new Uint8Array(map.width * map.height).fill(1);

    const dungeon = visibilityFrameForPlayer(session, players[0]!).dungeon;
    expect(dungeon.puzzles).toEqual([]);
    expect(dungeon.doors.map((door) => [door.id, door.voteIcon])).toEqual([
      [LEFT_DOOR, "loot"],
      [RIGHT_DOOR, "danger"],
    ]);
    expect(doorStateSchema.safeParse(dungeon.doors[0]).success).toBe(true);
  });
});

describe("Door Vote saves", () => {
  it("saves and restores a hold in progress, and finishes it after the reload", () => {
    const { session, vote, leftPlates, stand } = withVote(3);
    stand(leftPlates);
    resolvePuzzles(session, 1000);
    resolvePuzzles(session, 1000 + type.holdMs / 2);

    // Every key of a save is validated as an id, so a vote's timer must be one.
    const run = captureRun(session, 1000 + type.holdMs / 2, "test");
    expect(() => persistedRunSchema.shape.puzzleHeldForMs.parse(run.puzzleHeldForMs)).not.toThrow();
    expect(Object.keys(run.puzzleHeldForMs)).toEqual([VOTE_ID]);

    const reloaded = withVote(3);
    reloaded.stand(reloaded.leftPlates);
    restoreRun(reloaded.session, run, 50_000);
    expect(reloaded.session.puzzleHeldSince.get(VOTE_ID)).toBe(50_000 - type.holdMs / 2);

    expect(resolvePuzzles(reloaded.session, 50_000 + type.holdMs / 2)).toHaveLength(1);
    expect(doorOf(reloaded.session, LEFT_DOOR).open).toBe(true);
    expect(vote.phase).toBe("idle");
  });

  it("starts over when the party shifts to another door", () => {
    const { session, vote, rightPlates, leftPlates, stand } = withVote(3);
    stand(leftPlates);
    resolvePuzzles(session, 0);
    resolvePuzzles(session, type.holdMs - 100);
    stand(rightPlates);
    resolvePuzzles(session, type.holdMs);
    expect(vote.phase).toBe("idle");
    expect(vote.progress).toBe(0);
  });
});
