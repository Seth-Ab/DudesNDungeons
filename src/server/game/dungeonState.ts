import { CARRY_MOVE_SPEED_MULTIPLIER } from "../../shared/constants/game.js";
import {
  MOVE_BURST_TOLERANCE_MS,
  MOVE_INTERVAL_MS,
  isOpen,
  stepFrom,
} from "../../shared/game/movement.js";
import type { DungeonState, MonsterState, PlayerId, Vector2 } from "../../shared/types/core.js";
import { gameContent, type GameContent } from "../content/loadContent.js";
import type { MonsterType } from "../content/schema.js";
import type { Session, SessionPlayer } from "../sessions/sessionStore.js";
import { buildAuthoredDungeon, type BuiltDungeon } from "./dungeonBuilder.js";
import { generateDungeon } from "./dungeonGenerator.js";
import { randomSeed } from "./random.js";
import { scaleDungeon } from "./scale.js";

/**
 * Tuning that stays on the server. Clients see a monster's position and health, never its stats.
 *
 * Keyed by content type id rather than by display name, so two monsters may share a name without
 * one silently inheriting the other's stats.
 */
export type MonsterStats = MonsterType;

export function monsterStatsFor(monster: MonsterState, content = gameContent()): MonsterStats {
  const stats = content.monsters.get(monster.typeId);
  if (!stats) throw new Error(`No stats for monster type "${monster.typeId}"`);
  return stats;
}

/** Which dungeon to build. Sessions use the hub first and this request when the party starts a run. */
export interface DungeonRequest {
  /** Content id of the dungeon definition. Defaults to the configured run. */
  dungeonId?: string;
  /** Seed for a generated dungeon. Omitted, a fresh one is drawn; pass one to replay a run. */
  seed?: number;
  content?: GameContent;
}

/** The generated run a new session gets when nothing asks for a specific dungeon. */
export const DEFAULT_DUNGEON_ID = "vault-run";
export const HUB_DUNGEON_ID = "hub";

export function buildDungeon(request: DungeonRequest = {}): BuiltDungeon {
  const content = request.content ?? gameContent();
  const dungeonId = request.dungeonId ?? DEFAULT_DUNGEON_ID;

  const definition = content.dungeons.get(dungeonId);
  if (!definition) throw new Error(`No dungeon content with id "${dungeonId}"`);

  const built =
    definition.layout === "authored"
      ? buildAuthoredDungeon(definition, content)
      : generateDungeon(definition, content, request.seed ?? randomSeed());

  // Content is authored small and played large. Every session gets the scaled world; nothing
  // downstream of here ever sees authored tile coordinates.
  return scaleDungeon(built);
}

export type MoveResult =
  | { ok: true; player: SessionPlayer }
  | { ok: false; reason: "blocked" | "outOfRange" | "onCooldown" | "notPermitted" };

function copyVector(vector: Vector2): Vector2 {
  return { x: vector.x, y: vector.y };
}

export function cloneDungeonState(dungeon: DungeonState): DungeonState {
  return {
    map: {
      ...dungeon.map,
      tiles: [...dungeon.map.tiles],
    },
    rooms: dungeon.rooms.map((room) => ({ ...room })),
    monsters: dungeon.monsters.map((monster) => ({
      ...monster,
      position: copyVector(monster.position),
    })),
    loot: dungeon.loot.map((loot) => ({ ...loot, position: copyVector(loot.position) })),
    traps: dungeon.traps.map((trap) => ({ ...trap, position: copyVector(trap.position) })),
    puzzles: dungeon.puzzles.map((puzzle) => ({
      ...puzzle,
      plates: puzzle.plates.map((plate) => ({ ...plate, position: copyVector(plate.position) })),
    })),
    doors: dungeon.doors.map((door) => ({ ...door, position: copyVector(door.position) })),
    exits: dungeon.exits.map((exit) => ({ ...exit, position: copyVector(exit.position) })),
    lightSources: dungeon.lightSources.map((light) => ({
      ...light,
      position: copyVector(light.position),
    })),
  };
}

/** A downed player cannot act, blocks nobody, and is ignored until revival or the run ends. */
export function isDown(player: SessionPlayer): boolean {
  return player.health <= 0;
}

/**
 * The first spawn point nobody is standing on. Choosing by party size is not enough: after someone
 * leaves, the next arrival would land on top of a player who stayed.
 */
export function findSpawnPoint(session: Session): Vector2 {
  const open = session.spawnPoints.find((point) => canOccupy(session, point));
  if (open) return copyVector(open);

  // Players can be standing on every spawn point, so any free floor tile will do.
  const { map } = session.dungeon;
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const tile = { x, y };
      if (canOccupy(session, tile)) return tile;
    }
  }

  throw new Error("Dungeon has no free floor to spawn on");
}

function blockingPlayerPositions(session: Session, mover?: SessionPlayer): Vector2[] {
  return [...session.players.values()]
    .filter((player) => player.id !== mover?.id && !isDown(player))
    .map((player) => player.position);
}

/** `mover` is the player moving there; omit it when placing a player who is not in the dungeon yet. */
export function canOccupy(session: Session, position: Vector2, mover?: SessionPlayer): boolean {
  return isOpen(session.dungeon, blockingPlayerPositions(session, mover), position, mover?.position);
}

/**
 * Resolves one movement intent. `now` is the server's monotonic clock in ms.
 *
 * Pacing is a leaky bucket: each accepted move books one `MOVE_INTERVAL_MS`, and a move may arrive
 * up to `MOVE_BURST_TOLERANCE_MS` ahead of that schedule. Jittered intents still land, but the
 * long-run speed never exceeds `PLAYER_MOVE_SPEED`. Blocked moves book nothing.
 */
export function movePlayer(
  session: Session,
  playerId: PlayerId,
  direction: Vector2,
  now: number,
): MoveResult {
  const player = session.players.get(playerId);
  if (!player) return { ok: false, reason: "outOfRange" };
  if (isDown(player)) return { ok: false, reason: "notPermitted" };

  const step = stepFrom(
    player.position,
    direction,
    player.carryingPlayerId ? CARRY_MOVE_SPEED_MULTIPLIER : 1,
  );
  if (!step) return { ok: false, reason: "outOfRange" };

  const due = player.nextMoveAt ?? now;
  if (now < due - MOVE_BURST_TOLERANCE_MS) {
    return { ok: false, reason: "onCooldown" };
  }

  player.facing = step.heading;

  if (!canOccupy(session, step.next, player)) {
    return { ok: false, reason: "blocked" };
  }

  player.position = step.next;
  player.nextMoveAt = Math.max(due, now) + MOVE_INTERVAL_MS;

  // A carried player is an inert body, not a separate mover: they follow the carrier's position
  // exactly rather than being simulated, which is also what keeps them clear of collision checks
  // (`isDown` players never block, per `blockingPlayerPositions`).
  if (player.carryingPlayerId) {
    const carried = session.players.get(player.carryingPlayerId);
    if (carried) carried.position = copyVector(player.position);
  }

  return { ok: true, player };
}
