import { ELITE_HEALTH_MULT } from "../../shared/constants/game.js";
import type {
  AltarState,
  ChestState,
  DoorState,
  DummyState,
  DungeonState,
  ExitState,
  LightSourceState,
  LootState,
  MonsterState,
  RoomState,
  PuzzleState,
  TrapState,
  Vector2,
} from "../../shared/types/core.js";
import type { GameContent } from "../content/loadContent.js";
import {
  consumableTarget,
  type AuthoredDungeon,
  type ItemDefinition,
  type MonsterType,
  type PuzzleType,
  type TrapType,
} from "../content/schema.js";
import { createRng, type Rng } from "./random.js";

/**
 * Turns authored content into a live dungeon.
 *
 * Content is a description; `DungeonState` is an instance with entity ids, current health, and
 * whether a door is open. Each session gets its own instance so one party opening a door does not
 * open it for everyone, which is why this builds rather than shares.
 */

export interface BuiltDungeon {
  /**
   * The live world. Built at authored tile scale and blown up to world scale by
   * `src/server/game/scale.ts` before a session ever sees it.
   */
  dungeon: DungeonState;
  /** Where players start. Authored dungeons list them; generated ones use the entrance room. */
  spawnPoints: Vector2[];
  /** The seed a generated dungeon came from, or null when it was laid out by hand. */
  seed: number | null;
  /** Ids of the omens a generated run rolled, warning first. Absent for a dungeon without any. */
  omens?: string[];
}

/**
 * What a wind-up draws. A melee swing is its cone; a bolt or a dash is a narrow lane as long as it
 * travels, so the same telegraph tells a player which line to step out of.
 */
function telegraphShape(type: MonsterType): Pick<MonsterState, "hitRange" | "hitArcCos"> {
  if (type.behavior === "ranged" && type.projectile) {
    return { hitRange: type.projectile.range, hitArcCos: LANE_ARC_COS };
  }
  if (type.behavior === "charger" && type.charge) {
    return { hitRange: type.charge.distance, hitArcCos: LANE_ARC_COS };
  }
  return { hitRange: type.hitRange ?? type.attackRange, hitArcCos: type.hitArcCos };
}

/** Cosine of a few degrees: a lane drawn as a sliver of a cone. */
const LANE_ARC_COS = 0.985;

export function monsterInstance(type: MonsterType, position: Vector2, id: string, elite = false): MonsterState {
  const maxHealth = elite ? Math.round(type.maxHealth * ELITE_HEALTH_MULT) : type.maxHealth;
  return {
    id,
    typeId: type.id,
    name: elite ? `Elite ${type.name}` : type.name,
    position: { ...position },
    health: maxHealth,
    maxHealth,
    alive: true,
    boss: type.boss,
    elite,
    action: "idle",
    behavior: type.behavior,
    windupProgress: 0,
    facing: { x: 0, y: 1 },
    ...telegraphShape(type),
  };
}

export function trapInstance(type: TrapType, position: Vector2, id: string): TrapState {
  return {
    id,
    typeId: type.id,
    name: type.name,
    position: { ...position },
    radius: type.radius,
    phase: "armed",
  };
}

export function puzzleInstance(type: PuzzleType, plates: Vector2[], id: string): PuzzleState {
  return {
    id,
    typeId: type.id,
    name: type.name,
    radius: type.plateRadius,
    heldBy: type.heldBy,
    phase: "idle",
    plates: plates.map((position) => ({ position: { ...position }, held: false })),
    progress: 0,
  };
}

/** The content id of the idol an Idol Carry puzzle's altar waits for. */
export const IDOL_ITEM_ID = "heavy-idol";

/** The content id of the stone that stands in for a missing player on a plate. */
export const BALLAST_ITEM_ID = "ballast-stone";

/**
 * How many Ballast Stones a puzzle needs so that players plus stones can hold every plate. Plates
 * are held by different players, so one more plate than people is one stone.
 */
export function ballastNeeded(plateCount: number, partySize: number): number {
  return Math.max(0, plateCount - partySize);
}

export function altarInstance(offer: readonly string[], position: Vector2, id: string): AltarState {
  return { id, position: { ...position }, offer: [...offer], taken: null };
}

export function chestInstance(
  lootTableId: string,
  position: Vector2,
  id: string,
  locked: boolean,
  twinLock = false,
): ChestState {
  return { id, lootTableId, position: { ...position }, opened: false, locked, twinLock, keyTurnedBy: null };
}

/** `count` is the stack size for ammo, clamped to its `maxStack`, and ignored for anything else. */
export function lootInstance(item: ItemDefinition, position: Vector2, id: string, count = 1): LootState {
  const instance = {
    id,
    name: item.name,
    position: { ...position },
    pickedUp: false,
  };

  switch (item.kind) {
    case "skillScroll":
      return { ...instance, kind: item.kind, skillId: item.skillId };
    case "consumable":
      return {
        ...instance,
        kind: item.kind,
        itemId: item.id,
        description: item.description,
        icon: item.icon,
        useOn: consumableTarget(item),
      };
    case "weapon":
      return { ...instance, kind: item.kind, itemId: item.id, weaponKind: item.weapon.kind };
    case "ammo":
      return { ...instance, kind: item.kind, itemId: item.id, count: Math.min(count, item.maxStack) };
    case "key":
      return { ...instance, kind: item.kind, itemId: item.id };
    default:
      return { ...instance, kind: item.kind };
  }
}

/**
 * The id an authored placement gets. A pinned `entityId` wins; otherwise one is drawn from a stream
 * seeded by the dungeon id, so an authored dungeon still builds the same ids every time without the
 * author having to write a UUID for every torch.
 */
function authoredId(pinned: string | undefined, rng: Rng): string {
  return pinned ?? rng.uuid();
}

/** A stable numeric seed for a string, so an authored dungeon id maps to one fixed stream. */
export function seedFromString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function buildAuthoredDungeon(
  definition: AuthoredDungeon,
  content: GameContent,
): BuiltDungeon {
  const rng = createRng(seedFromString(definition.id));

  const rooms: RoomState[] = definition.rooms.map((room) => ({
    id: rng.uuid(),
    name: room.name,
    kind: room.kind,
    x: room.x,
    y: room.y,
    width: room.width,
    height: room.height,
  }));

  const monsters: MonsterState[] = definition.monsters.map((placed) => {
    const type = content.monsters.get(placed.typeId);
    // Unreachable via loadContent, which checks every reference, but a hand-built catalog in a test
    // could miss one and a monster with no stats crashes much later and much less clearly.
    if (!type) throw new Error(`Dungeon "${definition.id}" places unknown monster "${placed.typeId}"`);

    return monsterInstance(type, { x: placed.x, y: placed.y }, authoredId(placed.entityId, rng));
  });

  const loot: LootState[] = definition.loot.map((placed) => {
    const item = content.items.get(placed.itemId);
    if (!item) throw new Error(`Dungeon "${definition.id}" places unknown item "${placed.itemId}"`);

    return lootInstance(item, { x: placed.x, y: placed.y }, authoredId(placed.entityId, rng), placed.count);
  });

  const traps: TrapState[] = definition.traps.map((placed) => {
    const type = content.traps.get(placed.typeId);
    if (!type) throw new Error(`Dungeon "${definition.id}" places unknown trap "${placed.typeId}"`);

    return trapInstance(type, { x: placed.x, y: placed.y }, authoredId(placed.entityId, rng));
  });

  const puzzles: PuzzleState[] = definition.puzzles.map((placed) => {
    const type = content.puzzles.get(placed.typeId);
    if (!type) throw new Error(`Dungeon "${definition.id}" places unknown puzzle "${placed.typeId}"`);

    return puzzleInstance(type, placed.plates, authoredId(placed.entityId, rng));
  });

  const chests: ChestState[] = definition.chests.map((placed) => {
    if (!content.lootTables.has(placed.lootTableId)) {
      throw new Error(`Dungeon "${definition.id}" places a chest with unknown loot table "${placed.lootTableId}"`);
    }

    return chestInstance(placed.lootTableId, { x: placed.x, y: placed.y }, authoredId(placed.entityId, rng), placed.locked);
  });

  const doors: DoorState[] = definition.doors.map((placed) => ({
    id: authoredId(placed.entityId, rng),
    position: { x: placed.x, y: placed.y },
    // One authored tile. Widened along with everything else when the dungeon is scaled.
    size: 1,
    open: false,
    lock: placed.lock,
  }));

  const exits: ExitState[] = definition.exits.map((placed) => ({
    id: authoredId(placed.entityId, rng),
    position: { x: placed.x, y: placed.y },
    destination: placed.destination,
    sealed: false,
  }));

  // A dummy starts with an empty readout; `dummies.ts` fills it in as it is hit.
  const dummies: DummyState[] = definition.dummies.map((placed) => ({
    id: placed.entityId,
    position: { x: placed.x, y: placed.y },
    recentDamage: 0,
    dps: 0,
    attackers: [],
  }));

  const lightSources: LightSourceState[] = definition.lights.map((placed) => ({
    id: authoredId(placed.entityId, rng),
    name: placed.name,
    kind: "fixed" as const,
    position: { x: placed.x, y: placed.y },
    radius: placed.radius,
    ...(placed.tint ? { tint: placed.tint } : {}),
    ...(placed.fixture ? { fixture: placed.fixture } : {}),
    ...(placed.flicker ? { flicker: placed.flicker } : {}),
  }));

  return {
    dungeon: {
      map: {
        id: definition.id,
        name: definition.name,
        width: definition.tiles[0]?.length ?? 0,
        height: definition.tiles.length,
        originX: 0,
        originY: 0,
        tiles: [...definition.tiles],
        theme: definition.theme,
        props: definition.props.map((prop) => ({ ...prop })),
        ...(definition.ground ? { ground: [...definition.ground] } : {}),
        ...(definition.seats.length > 0
          ? {
              seats: definition.seats.map((seat) => ({
                id: seat.entityId,
                x: seat.x,
                y: seat.y,
                facing: seat.facing,
              })),
            }
          : {}),
        ...(definition.readyPlates.length > 0
          ? {
              readyPlates: definition.readyPlates.map((plate) => ({
                id: plate.entityId,
                x: plate.x,
                y: plate.y,
              })),
            }
          : {}),
      },
      rooms,
      monsters,
      projectiles: [],
      loot,
      chests,
      altars: [],
      traps,
      puzzles,
      doors,
      exits,
      lightSources,
      dummies,
    },
    spawnPoints: definition.spawnPoints.map((point) => ({ x: point.x, y: point.y })),
    seed: null,
  };
}
