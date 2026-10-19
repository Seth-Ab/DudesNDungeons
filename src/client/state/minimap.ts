import { tileOf } from "../../shared/game/movement.js";
import type { DungeonMapState, ExitState, PlayerState, Vector2 } from "../../shared/types/core.js";
import type { SessionView } from "../network/sessionState.js";
import { partyMemberState } from "./hudView.js";

/**
 * What the minimap shows, kept free of the DOM so the node test environment can drive it. The panel
 * draws it from the discovered map the client already accumulates (`discoveredMap.ts`): nothing here
 * adds entity data or asks the server for anything.
 */

/** Pixels per side of the square panel's drawing surface. */
export const MINIMAP_SIZE = 168;

/** Below this many pixels per tile the whole world is too small to read, so the panel windows instead. */
export const MINIMAP_MIN_SCALE = 2;

/** A small room should not blow up into huge blocks. */
export const MINIMAP_MAX_SCALE = 6;

export interface MinimapViewport {
  /** Pixels per world tile. */
  scale: number;
  /** World tile drawn at the panel's top-left corner; fractional when the world is windowed. */
  left: number;
  top: number;
  /** World tiles that fit across the panel. */
  tilesAcross: number;
}

/**
 * Fits the world to the panel. A world that fits at a readable scale is shown whole and centred;
 * a larger one is shown as a window around `center`, clamped so the window never runs off the map.
 */
export function minimapViewport(
  worldWidth: number,
  worldHeight: number,
  center: Vector2,
  size: number = MINIMAP_SIZE,
): MinimapViewport {
  const fit = size / Math.max(worldWidth, worldHeight);
  const scale = Math.min(MINIMAP_MAX_SCALE, Math.max(MINIMAP_MIN_SCALE, fit));
  const tilesAcross = size / scale;

  const axis = (world: number, at: number): number => {
    if (world <= tilesAcross) return (world - tilesAcross) / 2;
    return Math.min(Math.max(at + 0.5 - tilesAcross / 2, 0), world - tilesAcross);
  };

  return { scale, left: axis(worldWidth, center.x), top: axis(worldHeight, center.y), tilesAcross };
}

/** World tile to the panel pixel of its top-left corner. */
export function minimapPoint(
  viewport: MinimapViewport,
  tileX: number,
  tileY: number,
): { x: number; y: number } {
  return {
    x: (tileX - viewport.left) * viewport.scale,
    y: (tileY - viewport.top) * viewport.scale,
  };
}

export type MinimapTile = "unknown" | "wall" | "floor";

export function minimapTile(map: DungeonMapState, x: number, y: number): MinimapTile {
  const char = map.tiles[y - map.originY]?.[x - map.originX];
  if (char === undefined || char === " ") return "unknown";
  return char === "#" ? "wall" : "floor";
}

export type MinimapAllyShape = "standing" | "downed";

export interface MinimapAlly {
  id: string;
  tile: Vector2;
  /** Shape, not colour, carries the state: a ring stands, a cross is downed. */
  shape: MinimapAllyShape;
}

/**
 * Allies on the map are exactly the ones in the latest snapshot's visible `players` list, the same
 * rule party frames follow. A player who has walked out of sight is not remembered here, and one
 * still designing a character is not in the world to be marked.
 */
export function minimapAllies(view: SessionView): MinimapAlly[] {
  const visible = new Set(view.visiblePlayerIds);
  return view.players
    .filter(
      (player) => player.id !== view.selfId && visible.has(player.id) && player.appearance !== null,
    )
    .map((player) => ({
      id: player.id,
      tile: tileOf(player.position),
      shape: allyShape(player),
    }));
}

function allyShape(player: PlayerState): MinimapAllyShape {
  const state = partyMemberState(player);
  return state === "downed" || state === "beingCarried" ? "downed" : "standing";
}

/**
 * One key per world a map belongs to: the hub, or one run. Consecutive runs can share a map id, but
 * a party always passes through the hub between them, so the location tells them apart. Null when
 * the player is in no session.
 */
export function minimapWorldKey(view: SessionView): string | null {
  const map = view.dungeon?.map;
  if (view.phase !== "inSession" || !map) return null;
  return `${view.location ?? "?"}:${map.id}:${map.width}x${map.height}`;
}

export interface RememberedExits {
  worldKey: string | null;
  exits: ReadonlyMap<string, Vector2>;
}

export const NO_EXITS: RememberedExits = { worldKey: null, exits: new Map() };

/**
 * Exits arrive only while the player can see them, so the minimap keeps the ones it has been sent
 * for the life of the world and forgets them when the world changes.
 */
export function rememberExits(
  remembered: RememberedExits,
  worldKey: string | null,
  current: readonly ExitState[],
): RememberedExits {
  const base = remembered.worldKey === worldKey ? remembered : { worldKey, exits: new Map() };
  if (worldKey === null) return base === remembered ? remembered : NO_EXITS;

  let exits: Map<string, Vector2> | null = null;
  for (const exit of current) {
    const known = base.exits.get(exit.id);
    if (known && known.x === exit.position.x && known.y === exit.position.y) continue;
    exits ??= new Map(base.exits);
    exits.set(exit.id, exit.position);
  }
  return exits ? { worldKey, exits } : base;
}

export interface MinimapVisibility {
  worldKey: string | null;
  visible: boolean;
}

/**
 * Whether the panel is shown. The player's toggle survives map refreshes (every discovery delta
 * makes a new map object) but a new world starts shown again.
 */
export function syncMinimapVisibility(
  previous: MinimapVisibility,
  worldKey: string | null,
): MinimapVisibility {
  return worldKey === previous.worldKey ? previous : { worldKey, visible: true };
}
