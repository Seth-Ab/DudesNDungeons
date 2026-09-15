import {
  PLAYER_TORCH_LIGHT_RADIUS,
  VOICE_FULL_VOLUME_DISTANCE,
  VOICE_SILENCE_DISTANCE,
} from "../../shared/constants/game.js";
import { distance, tileOf } from "../../shared/game/movement.js";
import type {
  DungeonState,
  LightSourceState,
  PlayerId,
  PlayerState,
  RoomState,
  Vector2,
} from "../../shared/types/core.js";
import type { ServerMessage } from "../../shared/protocol/index.js";
import { rosterOf, type Session, type SessionPlayer } from "../sessions/sessionStore.js";
import { monsterStatsFor } from "./dungeonState.js";

const UNKNOWN_TILE = " ";
const DISCOVERED_FLOOR_TILE = ",";
const DISCOVERED_WALL_TILE = "+";

export interface VisibilityFrame {
  dungeon: DungeonState;
  players: PlayerState[];
  visiblePlayerIds: Set<PlayerId>;
}

interface ActiveLightSource extends LightSourceState {
  origin: Vector2;
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

function carriedTorchFor(player: SessionPlayer): ActiveLightSource | null {
  if (!player.carryingTorch) return null;

  return {
    id: player.id,
    name: `${player.name}'s Torch`,
    kind: "carriedTorch",
    position: { ...player.position },
    origin: player.position,
    radius: PLAYER_TORCH_LIGHT_RADIUS,
  };
}

function activeLightSourcesForPlayer(session: Session, viewer: SessionPlayer): ActiveLightSource[] {
  const sources: ActiveLightSource[] = [];
  const ownTorch = carriedTorchFor(viewer);
  if (ownTorch) sources.push(ownTorch);

  for (const light of session.dungeon.lightSources) {
    if (!hasLineOfSight(session.dungeon, viewer.position, light.position)) continue;
    sources.push({ ...light, position: { ...light.position }, origin: light.position });
  }

  for (const player of session.players.values()) {
    if (player.id === viewer.id || !player.connected || player.health <= 0) continue;

    const torch = carriedTorchFor(player);
    if (!torch || !hasLineOfSight(session.dungeon, viewer.position, player.position)) continue;
    sources.push(torch);
  }

  for (const monster of session.dungeon.monsters) {
    if (!monster.alive) continue;

    const glowRadius = monsterStatsFor(monster).glowRadius;
    if (glowRadius === undefined) continue;
    if (!hasLineOfSight(session.dungeon, viewer.position, monster.position)) continue;

    sources.push({
      id: monster.id,
      name: `${monster.name} Glow`,
      kind: "monsterGlow",
      position: { ...monster.position },
      origin: monster.position,
      radius: glowRadius,
    });
  }

  return sources;
}

/**
 * Tiles this player can currently see, from their light sources and line of sight.
 *
 * Scanned per light rather than per tile. Sweeping the whole map for every source is fine on a
 * hand-authored 16x8 room and ruinous on a generated 96x64 one: it made this the most expensive
 * thing the server did, at several milliseconds per player per tick. A light can only ever reach
 * inside its own radius, so only that box is worth testing.
 */
export function visibleTilesForPlayer(
  session: Session,
  viewer: SessionPlayer,
  sources = activeLightSourcesForPlayer(session, viewer),
): Set<string> {
  const visible = new Set<string>();
  const { map } = session.dungeon;

  for (const source of sources) {
    const minX = Math.max(0, Math.floor(source.origin.x - source.radius));
    const maxX = Math.min(map.width - 1, Math.ceil(source.origin.x + source.radius));
    const minY = Math.max(0, Math.floor(source.origin.y - source.radius));
    const maxY = Math.min(map.height - 1, Math.ceil(source.origin.y + source.radius));

    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const key = tileKey(x, y);
        // Another source already lit it, and the raycast is the expensive part.
        if (visible.has(key)) continue;

        const center = { x, y };
        if (distance(source.origin, center) > source.radius) continue;
        if (!hasLineOfSight(session.dungeon, source.origin, center)) continue;

        visible.add(key);
      }
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

/** Whether the viewer has stepped into, or lit, any tile of this room. */
function hasDiscoveredPartOf(viewer: SessionPlayer, room: RoomState): boolean {
  for (let y = room.y; y < room.y + room.height; y += 1) {
    for (let x = room.x; x < room.x + room.width; x += 1) {
      if (viewer.discoveredTiles.has(tileKey(x, y))) return true;
    }
  }
  return false;
}

function visibleDungeon(
  session: Session,
  viewer: SessionPlayer,
  visible: Set<string>,
  sources: readonly ActiveLightSource[],
): DungeonState {
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
    // A room appears once the player has seen any part of it. Sending the full room list would hand
    // a client the shape of the dungeon - how many rooms, where the boss is - before they explore it.
    rooms: session.dungeon.rooms
      .filter((room) => hasDiscoveredPartOf(viewer, room))
      .map((room) => ({ ...room })),
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
    lightSources: sources
      .filter((light) => tileVisible(visible, light.position))
      .map(({ origin: _origin, ...light }) => ({
        ...light,
        position: { ...light.position },
      })),
    cleared: session.dungeon.cleared,
  };
}

export function visibilityFrameForPlayer(session: Session, viewer: SessionPlayer): VisibilityFrame {
  // Computed once and threaded through: gathering sources walks every light, player, and monster in
  // the dungeon, and the frame needs the same answer three times.
  const sources = activeLightSourcesForPlayer(session, viewer);
  const visible = visibleTilesForPlayer(session, viewer, sources);
  const visiblePlayers = rosterOf(session).filter(
    (player) => player.id === viewer.id || tileVisible(visible, player.position),
  );

  return {
    dungeon: visibleDungeon(session, viewer, visible, sources),
    players: visiblePlayers,
    visiblePlayerIds: new Set(visiblePlayers.map((player) => player.id)),
  };
}

function voiceVolume(gap: number): number {
  if (gap <= VOICE_FULL_VOLUME_DISTANCE) return 1;
  if (gap >= VOICE_SILENCE_DISTANCE) return 0;

  const falloff =
    (gap - VOICE_FULL_VOLUME_DISTANCE) / (VOICE_SILENCE_DISTANCE - VOICE_FULL_VOLUME_DISTANCE);
  return Math.max(0, Math.min(1, 1 - falloff));
}

/**
 * Voice falloff for the peers this player can see. Takes the frame rather than recomputing it: it is
 * sent alongside the same tick's snapshot, and visibility is the most expensive thing on the tick.
 */
export function voiceRangeForPlayer(
  session: Session,
  viewer: SessionPlayer,
  frame: VisibilityFrame = visibilityFrameForPlayer(session, viewer),
): Extract<ServerMessage, { type: "voiceRangeUpdated" }> {
  const peers = [...session.players.values()]
    .filter((player) => player.id !== viewer.id && frame.visiblePlayerIds.has(player.id))
    .map((player) => {
      const gap = distance(viewer.position, player.position);
      return {
        playerId: player.id,
        distance: gap,
        volume: voiceVolume(gap),
      };
    });

  return { type: "voiceRangeUpdated", peers };
}
