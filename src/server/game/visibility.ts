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
  Vector2,
} from "../../shared/types/core.js";
import type { ServerMessage } from "../../shared/protocol/index.js";
import { rosterOf, type Session, type SessionPlayer } from "../sessions/sessionStore.js";
import { monsterStatsFor } from "./dungeonState.js";

const UNKNOWN_TILE = " ";
const DISCOVERED_FLOOR_TILE = ",";
const DISCOVERED_WALL_TILE = "+";

interface VisibilityFrame {
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

export function visibleTilesForPlayer(session: Session, viewer: SessionPlayer): Set<string> {
  const visible = new Set<string>();
  const { map } = session.dungeon;
  const sources = activeLightSourcesForPlayer(session, viewer);

  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const center = { x, y };
      if (
        sources.some(
          (source) =>
            distance(source.origin, center) <= source.radius &&
            hasLineOfSight(session.dungeon, source.origin, center),
        )
      ) {
        visible.add(tileKey(x, y));
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
    lightSources: activeLightSourcesForPlayer(session, viewer)
      .filter((light) => tileVisible(visible, light.position))
      .map(({ origin: _origin, ...light }) => ({
        ...light,
        position: { ...light.position },
      })),
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

export function voiceRangeForPlayer(
  session: Session,
  viewer: SessionPlayer,
): Extract<ServerMessage, { type: "voiceRangeUpdated" }> {
  const frame = visibilityFrameForPlayer(session, viewer);
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
