import { PLAYER_LIGHT_RADIUS } from "../../shared/constants/game.js";
import { tileOf } from "../../shared/game/movement.js";
import type { DungeonState, PlayerState, Vector2 } from "../../shared/types/core.js";
import { rosterOf, type Session, type SessionPlayer } from "../sessions/sessionStore.js";

const UNKNOWN_TILE = " ";
const DISCOVERED_FLOOR_TILE = ",";
const DISCOVERED_WALL_TILE = "+";

interface VisibilityFrame {
  dungeon: DungeonState;
  players: PlayerState[];
}

function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

function isOpaque(dungeon: DungeonState, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= dungeon.map.width || y >= dungeon.map.height) return true;
  if (dungeon.map.tiles[y]?.[x] === "#") return true;

  return dungeon.doors.some((door) => {
    if (door.open) return false;
    const tile = tileOf(door.position);
    return tile.x === x && tile.y === y;
  });
}

function hasLineOfSight(dungeon: DungeonState, from: Vector2, to: Vector2): boolean {
  const target = tileOf(to);
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = Math.max(1, Math.ceil(distance / 0.2));

  for (let step = 1; step <= steps; step += 1) {
    const t = step / steps;
    const position = {
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
    };
    const tile = tileOf(position);
    if (tile.x === target.x && tile.y === target.y) continue;
    if (isOpaque(dungeon, tile.x, tile.y)) return false;
  }

  return true;
}

export function visibleTilesForPlayer(session: Session, viewer: SessionPlayer): Set<string> {
  const visible = new Set<string>();
  const { map } = session.dungeon;

  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const center = { x, y };
      if (Math.hypot(center.x - viewer.position.x, center.y - viewer.position.y) > PLAYER_LIGHT_RADIUS) {
        continue;
      }
      if (!hasLineOfSight(session.dungeon, viewer.position, center)) continue;

      visible.add(tileKey(x, y));
    }
  }

  return visible;
}

function tileVisible(visible: Set<string>, position: Vector2): boolean {
  const tile = tileOf(position);
  return visible.has(tileKey(tile.x, tile.y));
}

function discoveredTile(original: string): string {
  return original === "#" ? DISCOVERED_WALL_TILE : DISCOVERED_FLOOR_TILE;
}

function visibleDungeon(session: Session, viewer: SessionPlayer, visible: Set<string>): DungeonState {
  for (const key of visible) viewer.discoveredTiles.add(key);

  const tiles = session.dungeon.map.tiles.map((row, y) =>
    row
      .split("")
      .map((tile, x) => {
        const key = tileKey(x, y);
        if (visible.has(key)) return tile;
        if (viewer.discoveredTiles.has(key)) return discoveredTile(tile);
        return UNKNOWN_TILE;
      })
      .join(""),
  );

  return {
    map: {
      ...session.dungeon.map,
      tiles,
    },
    monsters: session.dungeon.monsters
      .filter((monster) => monster.alive && tileVisible(visible, monster.position))
      .map((monster) => ({ ...monster, position: { ...monster.position } })),
    loot: session.dungeon.loot
      .filter((loot) => !loot.pickedUp && tileVisible(visible, loot.position))
      .map((loot) => ({ ...loot, position: { ...loot.position } })),
    doors: session.dungeon.doors
      .filter((door) => viewer.discoveredTiles.has(tileKey(tileOf(door.position).x, tileOf(door.position).y)))
      .map((door) => ({ ...door, position: { ...door.position } })),
    exits: session.dungeon.exits
      .filter((exit) => tileVisible(visible, exit.position))
      .map((exit) => ({ ...exit, position: { ...exit.position } })),
    cleared: session.dungeon.cleared,
  };
}

export function visibilityFrameForPlayer(session: Session, viewer: SessionPlayer): VisibilityFrame {
  const visible = visibleTilesForPlayer(session, viewer);
  const visiblePlayers = rosterOf(session).filter(
    (player) => player.id === viewer.id || tileVisible(visible, player.position),
  );

  return {
    dungeon: visibleDungeon(session, viewer, visible),
    players: visiblePlayers,
  };
}
