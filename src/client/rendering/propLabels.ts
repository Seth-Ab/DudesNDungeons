import { MAP_PROP_SIZES } from "../../shared/constants/scenery.js";
import { TILE_SCALE } from "../../shared/constants/game.js";
import type { MapProp, Vector2 } from "../../shared/types/core.js";

/**
 * When a prop's name shows, and where it may be drawn.
 *
 * Free of the DOM so it can be tested under node. A name plate is shown in full when the local
 * player is close, fades to nothing (or to a small icon, for a stall) as they walk away, and is
 * always kept inside the part of the screen the HUD leaves free.
 */

/** How near the player must be for a prop's full name plate, in world units: four authored tiles. */
export const LABEL_RANGE = 4 * TILE_SCALE;

/** The distance over which a plate cross-fades with its icon, in world units: half an authored tile. */
export const LABEL_FADE = TILE_SCALE / 2;

export type LabelMode = "full" | "icon" | "hidden";

/** Kinds that keep a small icon visible beyond the plate's range, so a stall still reads from afar. */
const ICON_KINDS: ReadonlySet<MapProp["kind"]> = new Set(["stall"]);

/** How a prop's label draws at a given distance from the local player. */
export function labelMode(kind: MapProp["kind"], distance: number): LabelMode {
  if (distance <= LABEL_RANGE) return "full";

  return ICON_KINDS.has(kind) ? "icon" : "hidden";
}

/**
 * How opaque the plate and the icon are, each 0 to 1. They trade places across `LABEL_FADE`
 * centred on the range, so the two always sum to 1 for a kind with an icon and the plate alone
 * fades for one without.
 */
export function labelOpacity(distance: number): { plate: number; icon: number } {
  const plate = Math.max(0, Math.min(1, (LABEL_RANGE + LABEL_FADE / 2 - distance) / LABEL_FADE));

  return { plate, icon: 1 - plate };
}

/**
 * How far a point is from a prop's footprint, 0 when it stands inside it. A prop's `x`/`y` is the
 * centre of its top-left tile, so its footprint starts half a tile before that.
 */
export function distanceToProp(prop: MapProp, point: Vector2): number {
  const size = MAP_PROP_SIZES[prop.kind];
  const left = prop.x - 0.5;
  const top = prop.y - 0.5;
  const dx = Math.max(left - point.x, 0, point.x - (left + size.tilesWide));
  const dy = Math.max(top - point.y, 0, point.y - (top + size.tilesHigh));

  return Math.hypot(dx, dy);
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The area of a rectangle, 0 for an empty one. */
function areaOf(rect: Rect): number {
  return Math.max(0, rect.right - rect.left) * Math.max(0, rect.bottom - rect.top);
}

/**
 * The largest rectangle of the viewport that no obstacle covers, found by trimming the viewport
 * once per obstacle on whichever side loses the least area. HUD panels hug the screen's edges, so
 * each one is cleared by moving the nearest edge past it. Computed from the panels' measured
 * rectangles, so it follows the layout at any window size.
 */
export function safeArea(viewport: Rect, obstacles: readonly Rect[]): Rect {
  let safe = { ...viewport };

  for (const obstacle of obstacles) {
    const overlapsX = obstacle.left < safe.right && obstacle.right > safe.left;
    const overlapsY = obstacle.top < safe.bottom && obstacle.bottom > safe.top;
    if (!overlapsX || !overlapsY) continue;

    const trims: Rect[] = [
      { ...safe, right: Math.max(safe.left, obstacle.left) },
      { ...safe, left: Math.min(safe.right, obstacle.right) },
      { ...safe, bottom: Math.max(safe.top, obstacle.top) },
      { ...safe, top: Math.min(safe.bottom, obstacle.bottom) },
    ];
    safe = trims.reduce((best, trim) => (areaOf(trim) > areaOf(best) ? trim : best));
  }

  return safe;
}

/**
 * Moves a plate of the given size so it lies inside `safe`, keeping its centre where it can. A
 * plate too big for the area is pinned to the top-left rather than centred, so its start stays
 * readable.
 */
export function clampPlate(
  center: Vector2,
  width: number,
  height: number,
  safe: Rect,
): { left: number; top: number } {
  const clamp = (value: number, low: number, high: number): number =>
    high < low ? low : Math.max(low, Math.min(high, value));

  return {
    left: clamp(center.x - width / 2, safe.left, safe.right - width),
    top: clamp(center.y - height / 2, safe.top, safe.bottom - height),
  };
}

/** Height of one omen plate above the quest board, and the gap between plates. */
export const OMEN_ROW_HEIGHT = 28;
export const OMEN_ROW_GAP = 4;
/** Space kept under the omen stack for the board's own name plate. */
export const OMEN_BOARD_CLEARANCE = 48;

/**
 * The top edge of each omen row, clamped as one stack (with room left below it for the board's own
 * plate) so the rows keep their spacing wherever the board sits on screen instead of piling up on
 * the same edge.
 */
export function layoutOmenRows(anchorY: number, rows: number, safe: Rect): number[] {
  const stack = rows * OMEN_ROW_HEIGHT + (rows - 1) * OMEN_ROW_GAP;
  const total = stack + OMEN_BOARD_CLEARANCE;
  const { top } = clampPlate({ x: 0, y: anchorY - total / 2 }, 0, total, safe);
  return Array.from({ length: rows }, (_, row) => top + row * (OMEN_ROW_HEIGHT + OMEN_ROW_GAP));
}
