import { ELITE_KEY_ITEM_ID, TILE_SCALE } from "../../shared/constants/game.js";
import { PLAYER_RADIUS, coversTile, isFloor } from "../../shared/game/movement.js";
import type { DungeonState, MonsterState, Vector2 } from "../../shared/types/core.js";
import type { LootTable } from "../content/schema.js";
import type { Session } from "../sessions/sessionStore.js";
import { lootInstance, seedFromString } from "./dungeonBuilder.js";
import { contentForSession } from "./progression.js";
import { createRng, type Rng } from "./random.js";

/**
 * The drop stream for a freshly built world. A generated dungeon's seed is offset so the drop
 * stream is not the one that laid the dungeon out; an authored one is seeded by its id.
 */
export function lootRngFor(seed: number | null, dungeonId: string): Rng {
  const base = seed ?? seedFromString(dungeonId);
  return createRng((base ^ 0x9e3779b9) >>> 0);
}

/** Rolls a table: `rolls` independent weighted picks, each possibly nothing. */
export function rollLootTable(table: LootTable, rng: Rng): string[] {
  const total = table.entries.reduce((sum, entry) => sum + entry.weight, 0) + table.nothingWeight;
  const dropped: string[] = [];

  for (let roll = 0; roll < table.rolls; roll += 1) {
    let remaining = rng.next() * total;
    for (const entry of table.entries) {
      if (remaining < entry.weight) {
        dropped.push(entry.itemId);
        break;
      }
      remaining -= entry.weight;
    }
  }

  return dropped;
}

/** Spacing between drops so a pile stays individually pickable. */
const DROP_SPACING = PLAYER_RADIUS * 2;
const DROP_SEARCH_MAX_RADIUS = TILE_SCALE;
const DROP_SEARCH_ANGLES = 8;

function inDoorway(dungeon: DungeonState, position: Vector2): boolean {
  const tileX = Math.round(position.x);
  const tileY = Math.round(position.y);
  return dungeon.doors.some((door) => coversTile(door, tileX, tileY));
}

function crowded(dungeon: DungeonState, position: Vector2): boolean {
  return dungeon.loot.some(
    (loot) =>
      !loot.pickedUp &&
      Math.hypot(loot.position.x - position.x, loot.position.y - position.y) < DROP_SPACING,
  );
}

/**
 * The origin if it is free, else the nearest open floor around it, found by searching rings
 * outward. Walls and doorways (open or closed) never qualify. When nothing nearby is free it falls
 * back to the origin, which is still the floor the monster or chest stood on.
 *
 * `clearance` keeps drops at least that far out, for an origin something is still standing on: a
 * chest's loot spills beside it rather than underneath where its sprite would hide it.
 */
function dropPosition(dungeon: DungeonState, origin: Vector2, clearance = 0): Vector2 {
  const usable = (position: Vector2): boolean =>
    isFloor(dungeon, position) && !inDoorway(dungeon, position) && !crowded(dungeon, position);

  if (clearance === 0 && usable(origin)) return { ...origin };

  const first = Math.max(DROP_SPACING, clearance);
  for (let radius = first; radius <= DROP_SEARCH_MAX_RADIUS; radius += DROP_SPACING) {
    for (let step = 0; step < DROP_SEARCH_ANGLES; step += 1) {
      const angle = (step / DROP_SEARCH_ANGLES) * Math.PI * 2;
      const candidate = {
        x: origin.x + Math.cos(angle) * radius,
        y: origin.y + Math.sin(angle) * radius,
      };
      if (usable(candidate)) return candidate;
    }
  }

  return { ...origin };
}

/**
 * Puts one item on open floor near `origin`, no closer than `clearance`, as ordinary loot. Throws
 * on an unknown item id, which `source` names.
 */
export function dropItemNear(session: Session, itemId: string, origin: Vector2, source: string, clearance = 0): void {
  const item = contentForSession(session).items.get(itemId);
  if (!item) throw new Error(`${source} drops unknown item "${itemId}"`);

  session.dungeon.loot.push(
    lootInstance(item, dropPosition(session.dungeon, origin, clearance), session.lootRng.uuid()),
  );
}

/**
 * Rolls `table` from the session's drop stream and puts each result on open floor near `origin`,
 * no closer than `clearance`. `source` names what dropped it, for the error a bad item id raises.
 */
export function spillLootTable(
  session: Session,
  table: LootTable,
  origin: Vector2,
  source: string,
  clearance = 0,
): void {
  const content = contentForSession(session);

  for (const itemId of rollLootTable(table, session.lootRng)) {
    const item = content.items.get(itemId);
    if (!item) throw new Error(`${source} drops unknown item "${itemId}"`);

    session.dungeon.loot.push(
      lootInstance(item, dropPosition(session.dungeon, origin, clearance), session.lootRng.uuid()),
    );
  }
}

/**
 * Rolls the dead monster's table and puts each drop on open floor at or near the corpse. An elite
 * also drops the vault key it carries, outside the table roll, so it never depends on a roll and
 * does not matter whose hands the killing blow came from.
 */
export function dropMonsterLoot(session: Session, monster: MonsterState): void {
  const content = contentForSession(session);
  const table = content.monsters.get(monster.typeId)?.loot;
  if (table) spillLootTable(session, table, monster.position, `Monster "${monster.typeId}"`);

  if (monster.elite) {
    const key = content.items.get(ELITE_KEY_ITEM_ID);
    if (!key) throw new Error(`Elite "${monster.typeId}" carries unknown item "${ELITE_KEY_ITEM_ID}"`);
    session.dungeon.loot.push(lootInstance(key, dropPosition(session.dungeon, monster.position), session.lootRng.uuid()));
  }
}
