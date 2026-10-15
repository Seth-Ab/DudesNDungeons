import type { DungeonMapState, MapDiscovery } from "../../shared/types/core.js";

/**
 * The tiles the viewer's light reaches right now, as the last snapshot said.
 *
 * Kept beside the discovered map rather than inside it: the map accumulates, while this is replaced
 * whole by every snapshot. The renderer shades only these tiles as lit; every other discovered tile
 * is remembered geometry and draws dark.
 *
 * Held as runs per row rather than as a world-sized grid, since a snapshot lights a few hundred
 * tiles of a world of a hundred thousand and arrives twenty times a second.
 */
export interface LitTileSet {
  /** The world these tiles belong to. A set for another world lights nothing. */
  id: string;
  width: number;
  height: number;
  /** World row to its lit spans, as flat `[start, end)` pairs. */
  rows: ReadonlyMap<number, readonly number[]>;
}

/**
 * Builds the lit set from one snapshot's map payload.
 *
 * A run that falls outside the world is the server's mistake; it is dropped rather than wrapped onto
 * the next row, the same way `applyMapDiscovery` drops a bad geometry run.
 */
export function litTilesFrom(discovery: MapDiscovery): LitTileSet {
  const rows = new Map<number, number[]>();

  for (const [x, y, length] of discovery.lit) {
    if (y >= discovery.height || x + length > discovery.width) continue;

    let spans = rows.get(y);
    if (!spans) {
      spans = [];
      rows.set(y, spans);
    }
    spans.push(x, x + length);
  }

  return { id: discovery.id, width: discovery.width, height: discovery.height, rows };
}

/** Whether world tile `(x, y)` of `map` is lit. A set for another world or size lights nothing. */
export function isTileLit(lit: LitTileSet, map: DungeonMapState, x: number, y: number): boolean {
  if (lit.id !== map.id || lit.width !== map.width || lit.height !== map.height) return false;

  const spans = lit.rows.get(y);
  if (!spans) return false;

  for (let n = 0; n < spans.length; n += 2) {
    if (x >= spans[n]! && x < spans[n + 1]!) return true;
  }

  return false;
}
