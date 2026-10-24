import { randomUUID } from "node:crypto";
import { distance } from "../../shared/game/movement.js";
import type { PuzzleState } from "../../shared/types/core.js";
import type { PuzzleType } from "../content/schema.js";
import type { Session, SessionPlayer } from "../sessions/sessionStore.js";
import { lootInstance } from "./dungeonBuilder.js";
import { isDown } from "./dungeonState.js";
import { recordPuzzleSolved } from "./milestones.js";
import { contentForSession, progressionEffectTotal } from "./progression.js";

/**
 * Server-resolved cooperative puzzles.
 *
 * A puzzle is a set of pressure plates. It is solved when every plate is held by a different
 * player at the same moment and they all stay held for the required time. The server decides who
 * is holding what from where it has put each player; the client never says it pulled anything.
 */

/**
 * Standing, connected players eligible to hold a plate. Downed players and dropped connections do
 * not count, the same rule traps and monsters use, so a puzzle cannot be held by a body.
 */
function eligiblePlayers(session: Session): SessionPlayer[] {
  return [...session.players.values()].filter((player) => player.connected && !isDown(player));
}

/** Who or what is holding a plate: a player, a Ballast Stone lying on it, or nothing. */
type Holder = SessionPlayer | "ballast" | null;

/**
 * Whether a Ballast Stone lies on the plate. A stone that is carried is not on the floor, so it
 * holds nothing: lifting it off, or dropping it anywhere else, releases the plate.
 */
function ballasted(session: Session, puzzle: PuzzleState, plate: PuzzleState["plates"][number]): boolean {
  return session.dungeon.loot.some(
    (loot) =>
      loot.kind === "ballast" && !loot.pickedUp && distance(loot.position, plate.position) <= puzzle.radius,
  );
}

/**
 * Assigns each plate its holder. A plate with a Ballast Stone on it is held by the stone, which
 * frees the player to stand on another; the rest take their nearest unassigned eligible player in
 * reach. One player holds at most one plate, so two plates can never be held by a single person
 * standing between them. Plates are taken in authored order and ties break by join order, which
 * keeps the outcome deterministic.
 */
function holders(session: Session, puzzle: PuzzleState, players: SessionPlayer[]): Holder[] {
  const taken = new Set<string>();

  return puzzle.plates.map((plate): Holder => {
    if (ballasted(session, puzzle, plate)) return "ballast";

    let best: SessionPlayer | null = null;
    let bestDistance = Infinity;
    for (const player of players) {
      if (taken.has(player.id)) continue;
      const gap = distance(player.position, plate.position);
      if (gap <= puzzle.radius && gap < bestDistance) {
        best = player;
        bestDistance = gap;
      }
    }
    if (best) taken.add(best.id);
    return best;
  });
}

/**
 * How long the plates must stay held. Each point of puzzle power among the players currently
 * holding shortens it by the puzzle's `holdReductionMsPerPower`, never below `minHoldMs`.
 */
export function requiredHoldMs(type: PuzzleType, power: number): number {
  return Math.max(type.minHoldMs, type.holdMs - power * type.holdReductionMsPerPower);
}

/**
 * Updates every unsolved puzzle's plates and hold progress, and pays out any that complete.
 * Returns the puzzles solved by this step.
 *
 * Releasing any plate for any reason resets the hold to zero rather than pausing it, so partial
 * cooperation never accumulates.
 */
export function resolvePuzzles(session: Session, now: number): PuzzleState[] {
  if (session.location !== "dungeon") return [];

  const content = contentForSession(session);
  const players = eligiblePlayers(session);
  const solved: PuzzleState[] = [];

  for (const puzzle of session.dungeon.puzzles) {
    if (puzzle.phase === "solved") continue;

    const type = content.puzzles.get(puzzle.typeId);
    if (!type) throw new Error(`No puzzle type "${puzzle.typeId}"`);

    const assigned = holders(session, puzzle, players);
    puzzle.plates.forEach((plate, index) => {
      plate.held = assigned[index] !== null;
    });

    const everyoneHolding = assigned.every((holder) => holder !== null);
    if (!everyoneHolding) {
      session.puzzleHeldSince.delete(puzzle.id);
      puzzle.progress = 0;
      continue;
    }

    const since = session.puzzleHeldSince.get(puzzle.id) ?? now;
    session.puzzleHeldSince.set(puzzle.id, since);

    const holding = assigned.filter((holder): holder is SessionPlayer => holder !== null && holder !== "ballast");
    const power = holding.reduce(
      (total, holder) => total + progressionEffectTotal(holder, "puzzlePowerBonus", content),
      0,
    );
    const required = requiredHoldMs(type, power);
    puzzle.progress = Math.min(1, Math.max(0, (now - since) / required));
    if (puzzle.progress < 1) continue;

    const reward = content.items.get(type.rewardItemId);
    if (!reward) throw new Error(`Puzzle "${type.id}" rewards unknown item "${type.rewardItemId}"`);
    session.dungeon.loot.push(lootInstance(reward, puzzle.plates[0]!.position, randomUUID()));
    session.puzzleHeldSince.delete(puzzle.id);
    puzzle.phase = "solved";
    recordPuzzleSolved(holding);
    solved.push(puzzle);
  }

  return solved;
}
