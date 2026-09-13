import {
  MOVE_BURST_TOLERANCE_MS,
  MOVE_INTERVAL_MS,
  isOpen,
  stepFrom,
} from "../../shared/game/movement.js";
import type {
  DungeonState,
  LootState,
  MonsterState,
  PlayerId,
  PlayerState,
  Vector2,
} from "../../shared/types/core.js";
import type { Session, SessionPlayer } from "../sessions/sessionStore.js";

const SPAWN_POINTS: Vector2[] = [
  { x: 2, y: 2 },
  { x: 2, y: 5 },
  { x: 13, y: 2 },
  { x: 13, y: 5 },
];

const FIXED_DUNGEON: DungeonState = {
  map: {
    id: "ember-vault",
    name: "Ember Vault",
    width: 16,
    height: 8,
    tiles: [
      "################",
      "#..............#",
      "#..####........#",
      "#.......##.....#",
      "#..............#",
      "#.....###......#",
      "#..............#",
      "################",
    ],
  },
  monsters: [
    {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Ash Imp",
      position: { x: 11, y: 2 },
      health: 12,
      alive: true,
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      name: "Cinder Slime",
      position: { x: 5, y: 5 },
      health: 18,
      alive: true,
    },
  ],
  loot: [
    {
      id: "33333333-3333-4333-8333-333333333333",
      name: "Copper Key",
      position: { x: 12, y: 4 },
      pickedUp: false,
    },
    {
      id: "44444444-4444-4444-8444-444444444444",
      name: "Minor Tonic",
      position: { x: 4, y: 6 },
      pickedUp: false,
    },
  ],
  doors: [
    {
      id: "55555555-5555-4555-8555-555555555555",
      position: { x: 10, y: 6 },
      open: false,
      locked: true,
    },
  ],
  exits: [
    {
      id: "66666666-6666-4666-8666-666666666666",
      position: { x: 14, y: 6 },
      destination: "deeper vault",
    },
  ],
};

export type MoveResult =
  | { ok: true; player: SessionPlayer }
  | { ok: false; reason: "blocked" | "outOfRange" | "onCooldown" };

function copyVector(vector: Vector2): Vector2 {
  return { x: vector.x, y: vector.y };
}

function copyMonster(monster: MonsterState): MonsterState {
  return {
    ...monster,
    position: copyVector(monster.position),
  };
}

function copyLoot(loot: LootState): LootState {
  return {
    ...loot,
    position: copyVector(loot.position),
  };
}

export function createDungeonState(): DungeonState {
  return {
    map: {
      ...FIXED_DUNGEON.map,
      tiles: [...FIXED_DUNGEON.map.tiles],
    },
    monsters: FIXED_DUNGEON.monsters.map(copyMonster),
    loot: FIXED_DUNGEON.loot.map(copyLoot),
    doors: FIXED_DUNGEON.doors.map((door) => ({
      ...door,
      position: copyVector(door.position),
    })),
    exits: FIXED_DUNGEON.exits.map((exit) => ({
      ...exit,
      position: copyVector(exit.position),
    })),
  };
}

export function cloneDungeonState(dungeon: DungeonState): DungeonState {
  return {
    map: {
      ...dungeon.map,
      tiles: [...dungeon.map.tiles],
    },
    monsters: dungeon.monsters.map(copyMonster),
    loot: dungeon.loot.map(copyLoot),
    doors: dungeon.doors.map((door) => ({
      ...door,
      position: copyVector(door.position),
    })),
    exits: dungeon.exits.map((exit) => ({
      ...exit,
      position: copyVector(exit.position),
    })),
  };
}

/**
 * The first spawn point nobody is standing on. Choosing by party size is not enough: after someone
 * leaves, the next arrival would land on top of a player who stayed.
 */
export function findSpawnPoint(session: Session): Vector2 {
  const open = SPAWN_POINTS.find((point) => canOccupy(session, point));
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

function otherPositions(session: Session, mover?: SessionPlayer): Vector2[] {
  return [...session.players.values()]
    .filter((player) => player.id !== mover?.id)
    .map((player) => player.position);
}

/** `mover` is the player moving there; omit it when placing a player who is not in the dungeon yet. */
export function canOccupy(session: Session, position: Vector2, mover?: SessionPlayer): boolean {
  return isOpen(session.dungeon, otherPositions(session, mover), position, mover?.position);
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

  const step = stepFrom(player.position, direction);
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
  return { ok: true, player };
}

export function dungeonPlayerStates(session: Session): PlayerState[] {
  return [...session.players.values()].map((player) => ({
    id: player.id,
    name: player.name,
    position: copyVector(player.position),
    facing: copyVector(player.facing),
    health: player.health,
    ready: player.ready,
    connected: player.connected,
  }));
}
