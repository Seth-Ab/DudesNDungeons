import {
  PLAYER_MOVE_SPEED,
  SERVER_TICK_RATE_HZ,
} from "../../shared/constants/game.js";
import type {
  DungeonState,
  LootState,
  MonsterState,
  PlayerId,
  PlayerState,
  Vector2,
} from "../../shared/types/core.js";
import type { Session, SessionPlayer } from "../sessions/sessionStore.js";

const PLAYER_RADIUS = 0.35;
const PLAYER_STEP_DISTANCE = PLAYER_MOVE_SPEED / SERVER_TICK_RATE_HZ;
const MIN_DIRECTION_MAGNITUDE = 0.001;

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
  | { ok: false; reason: "blocked" | "outOfRange" };

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

export function spawnPointForIndex(index: number): Vector2 {
  const fallback = SPAWN_POINTS[0];
  if (!fallback) throw new Error("Dungeon has no spawn points");

  return copyVector(SPAWN_POINTS[index % SPAWN_POINTS.length] ?? fallback);
}

export function isFloor(dungeon: DungeonState, position: Vector2): boolean {
  const x = Math.floor(position.x);
  const y = Math.floor(position.y);
  if (x < 0 || y < 0 || x >= dungeon.map.width || y >= dungeon.map.height) return false;

  return dungeon.map.tiles[y]?.[x] === ".";
}

function distanceSquared(a: Vector2, b: Vector2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function collidesWithPlayer(
  session: Session,
  playerId: PlayerId,
  position: Vector2,
): boolean {
  for (const player of session.players.values()) {
    if (player.id === playerId) continue;
    if (distanceSquared(player.position, position) < (PLAYER_RADIUS * 2) ** 2) return true;
  }

  return false;
}

function collidesWithMonster(dungeon: DungeonState, position: Vector2): boolean {
  return dungeon.monsters.some(
    (monster) => monster.alive && distanceSquared(monster.position, position) < (PLAYER_RADIUS * 2) ** 2,
  );
}

function collidesWithClosedDoor(dungeon: DungeonState, position: Vector2): boolean {
  return dungeon.doors.some(
    (door) => !door.open && distanceSquared(door.position, position) < (PLAYER_RADIUS * 2) ** 2,
  );
}

export function canOccupy(session: Session, playerId: PlayerId, position: Vector2): boolean {
  return (
    isFloor(session.dungeon, position) &&
    !collidesWithPlayer(session, playerId, position) &&
    !collidesWithMonster(session.dungeon, position) &&
    !collidesWithClosedDoor(session.dungeon, position)
  );
}

export function movePlayer(session: Session, playerId: PlayerId, direction: Vector2): MoveResult {
  const player = session.players.get(playerId);
  if (!player) return { ok: false, reason: "outOfRange" };

  const magnitude = Math.hypot(direction.x, direction.y);
  if (magnitude < MIN_DIRECTION_MAGNITUDE) return { ok: false, reason: "outOfRange" };

  const normalized = { x: direction.x / magnitude, y: direction.y / magnitude };
  const next = {
    x: player.position.x + normalized.x * PLAYER_STEP_DISTANCE,
    y: player.position.y + normalized.y * PLAYER_STEP_DISTANCE,
  };

  player.facing = normalized;

  if (!canOccupy(session, player.id, next)) {
    return { ok: false, reason: "blocked" };
  }

  player.position = next;
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
