/**
 * Stage 7 of the dungeon generator (decision 0016): validate.
 *
 * Flood-fills the real tiles of a built dungeon, at authored scale, and reports every invariant it
 * breaks. The generator retries on any error rather than ship the run, and the seed sweep in
 * `tests/server/generation.test.ts` calls the same function, so the two cannot disagree about what
 * a finishable run is:
 *
 * - every spawn, entity, plate, door and exit is on open floor, and no two share a tile;
 * - with every lock closed, the boss room and every vault cannot be entered;
 * - collecting keys and solving puzzles in whatever order they become reachable opens a route to
 *   the exit, and every room is reachable by the end;
 * - the first spawn point stands inside a light, so the party does not arrive in the dark;
 * - no puzzle needs more plates held than the party has players plus Ballast Stones;
 * - an Idol Carry altar has one plate, and an idol of its own in reach before it counts as solved;
 * - a Twin-lock Chest appears only for a party that can open it, and they can reach it.
 *
 * Pure: it reads the dungeon and changes nothing.
 */
import { ELITE_KEY_ITEM_ID, TILE_SCALE } from "../../../shared/constants/game.js";
import type { RoomState, Vector2 } from "../../../shared/types/core.js";
import type { GameContent } from "../../content/loadContent.js";
import type { BuiltDungeon } from "../dungeonBuilder.js";
import { TWIN_LOCK_MIN_PARTY } from "../twinLocks.js";

const FLOOR = ".";
const STEPS: readonly Vector2[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

const key = (point: Vector2): string => `${point.x},${point.y}`;

/** Every tile a party can stand on from `start`, not crossing a tile in `blocked`. */
function flood(tiles: readonly string[], start: Vector2, blocked: ReadonlySet<string>): Set<string> {
  const seen = new Set([key(start)]);
  const queue = [start];
  for (let head = 0; head < queue.length; head += 1) {
    const here = queue[head]!;
    for (const step of STEPS) {
      const next = { x: here.x + step.x, y: here.y + step.y };
      const id = key(next);
      if (seen.has(id) || blocked.has(id) || tiles[next.y]?.[next.x] !== FLOOR) continue;
      seen.add(id);
      queue.push(next);
    }
  }
  return seen;
}

/** Whether `reach` holds a tile of the room's interior, which is what entering it means. */
function entersRoom(reach: ReadonlySet<string>, room: RoomState): boolean {
  for (let y = room.y + 1; y < room.y + room.height - 1; y += 1) {
    for (let x = room.x + 1; x < room.x + room.width - 1; x += 1) if (reach.has(`${x},${y}`)) return true;
  }
  return false;
}

/** The problems with `built`, empty when it is a finishable run for `partySize` players. */
export function validateDungeon(built: BuiltDungeon, content: GameContent, partySize: number): string[] {
  const { dungeon, spawnPoints } = built;
  const tiles = dungeon.map.tiles;
  const errors: string[] = [];

  const spawn = spawnPoints[0];
  if (!spawn || spawnPoints.length < Math.min(4, partySize)) errors.push("not enough spawn points");
  const exit = dungeon.exits[0];
  if (dungeon.exits.length !== 1 || !exit) errors.push("a run needs exactly one exit");
  if (errors.length > 0 || !spawn || !exit) return errors;

  const claimed = new Set<string>();
  const onFloor = (what: string, position: Vector2): void => {
    if (tiles[position.y]?.[position.x] !== FLOOR) errors.push(`${what} is off the floor at ${key(position)}`);
  };
  const solid = (what: string, position: Vector2): void => {
    onFloor(what, position);
    if (claimed.has(key(position))) errors.push(`${what} shares a tile at ${key(position)}`);
    claimed.add(key(position));
  };
  for (const point of spawnPoints) solid("spawn point", point);
  for (const monster of dungeon.monsters) solid("monster", monster.position);
  for (const loot of dungeon.loot) solid("loot", loot.position);
  for (const chest of dungeon.chests) solid("chest", chest.position);
  for (const altar of dungeon.altars) solid("altar", altar.position);
  for (const trap of dungeon.traps) solid("trap", trap.position);
  for (const door of dungeon.doors) solid("door", door.position);
  for (const placed of dungeon.exits) solid("exit", placed.position);
  for (const puzzle of dungeon.puzzles) for (const plate of puzzle.plates) solid("plate", plate.position);
  for (const light of dungeon.lightSources) onFloor("light", light.position);
  // Radii are world units and positions authored tiles, which `TILE_SCALE` world units span.
  const arrivesLit = dungeon.lightSources.some(
    (light) => Math.hypot(light.position.x - spawn.x, light.position.y - spawn.y) * TILE_SCALE <= light.radius,
  );
  if (!arrivesLit) errors.push("the first spawn point is outside every light");
  if (errors.length > 0) return errors;

  const lockedDoors = dungeon.doors.filter((door) => door.lock !== null);
  const closed = (opened: ReadonlySet<string>): Set<string> =>
    new Set(lockedDoors.filter((door) => !opened.has(door.id)).map((door) => key(door.position)));

  // Checked from the rooms, not the doors, so a lock that was never placed is caught too.
  const sealed = flood(tiles, spawn, closed(new Set()));
  for (const room of dungeon.rooms) {
    if ((room.kind === "boss" || room.kind === "vault") && entersRoom(sealed, room)) {
      errors.push(`the ${room.kind} room is reachable with every lock closed`);
    }
  }

  // Walk the run the way a party does: take what is in reach, spend keys on doors beside it, and
  // look again, until nothing more opens.
  const opened = new Set<string>();
  const gathered = new Set<string>();
  const solved = new Set<string>();
  /** Keys in hand and not yet spent, by content id; a door takes only the key its lock names. */
  const keys = new Map<string, number>();
  const addKey = (keyItemId: string): void => void keys.set(keyItemId, (keys.get(keyItemId) ?? 0) + 1);
  let reach = sealed;
  let idolAltarsSolved = 0;
  const idolsInReach = (tiles: ReadonlySet<string>): number =>
    dungeon.loot.filter((loot) => loot.kind === "idol" && tiles.has(key(loot.position))).length;
  for (let round = 0; round <= dungeon.loot.length + dungeon.puzzles.length + lockedDoors.length; round += 1) {
    let changed = false;
    for (const loot of dungeon.loot) {
      if (loot.kind !== "key" || gathered.has(loot.id) || !reach.has(key(loot.position))) continue;
      gathered.add(loot.id);
      addKey(loot.itemId);
      changed = true;
    }
    // An elite carries the vault key, which is in hand only once its tile is reachable.
    for (const monster of dungeon.monsters) {
      if (!monster.elite || gathered.has(monster.id) || !reach.has(key(monster.position))) continue;
      gathered.add(monster.id);
      addKey(ELITE_KEY_ITEM_ID);
      changed = true;
    }
    for (const puzzle of dungeon.puzzles) {
      if (solved.has(puzzle.id) || !puzzle.plates.every((plate) => reach.has(key(plate.position)))) continue;
      // An altar keeps the idol set on it, so each altar solved so far has used one up.
      if (puzzle.heldBy === "idol" && idolsInReach(reach) <= idolAltarsSolved) continue;
      solved.add(puzzle.id);
      if (puzzle.heldBy === "idol") {
        idolAltarsSolved += 1;
        if (puzzle.plates.length !== 1) errors.push(`idol altar ${puzzle.typeId} has ${puzzle.plates.length} plates`);
      } else {
        const stones = dungeon.loot.filter((loot) => loot.kind === "ballast" && reach.has(key(loot.position))).length;
        if (puzzle.plates.length > partySize + stones) {
          errors.push(`puzzle ${puzzle.typeId} needs ${puzzle.plates.length} plates held by ${partySize} players and ${stones} stones`);
        }
      }
      const reward = content.items.get(content.puzzles.get(puzzle.typeId)?.rewardItemId ?? "");
      if (reward?.kind === "key") addKey(reward.id);
      changed = true;
    }
    for (;;) {
      const next = lockedDoors.find(
        (door) =>
          !opened.has(door.id) &&
          door.lock?.type === "key" &&
          (keys.get(door.lock.keyItemId) ?? 0) > 0 &&
          STEPS.some((step) => reach.has(key({ x: door.position.x + step.x, y: door.position.y + step.y }))),
      );
      if (!next || next.lock?.type !== "key") break;
      keys.set(next.lock.keyItemId, (keys.get(next.lock.keyItemId) ?? 0) - 1);
      opened.add(next.id);
      changed = true;
      reach = flood(tiles, spawn, closed(opened));
    }
    if (!changed) break;
  }

  for (const puzzle of dungeon.puzzles) {
    if (solved.has(puzzle.id)) continue;
    const idolMissing = puzzle.heldBy === "idol" && puzzle.plates.every((plate) => reach.has(key(plate.position)));
    errors.push(idolMissing ? `puzzle ${puzzle.typeId} has no idol in reach` : `puzzle ${puzzle.typeId} cannot be reached`);
  }
  // Two players turn a twin lock from beside it, so it needs two of them and a way to it. A chest
  // sits on an authored tile, which scales to a block of open floor with room for both to stand.
  for (const chest of dungeon.chests) {
    if (!chest.twinLock) continue;
    if (partySize < TWIN_LOCK_MIN_PARTY) errors.push(`a twin-lock chest needs ${TWIN_LOCK_MIN_PARTY} players, not ${partySize}`);
    if (!reach.has(key(chest.position))) errors.push(`the twin-lock chest at ${key(chest.position)} cannot be reached`);
  }
  if (!reach.has(key(exit.position))) errors.push("the exit is unreachable after every key and puzzle");
  for (const room of dungeon.rooms) {
    if (!entersRoom(reach, room)) errors.push(`room "${room.name}" is unreachable`);
  }
  return errors;
}
