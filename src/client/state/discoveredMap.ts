import type { DungeonMapState, MapDiscovery } from "../../shared/types/core.js";

const UNKNOWN = " ";

/**
 * Folds one snapshot's map delta into the geometry the client already holds.
 *
 * The server sends the whole of a viewer's discovered geometry once (`reset`) and only newly
 * discovered tiles after that, so the client's map is the accumulation. It spans the whole world
 * with an origin of (0, 0), and tiles nobody has discovered are spaces, the same alphabet the old
 * per-snapshot window used.
 *
 * Rows a delta does not touch keep their string, and an empty delta returns `previous` itself, so
 * renderers can tell by reference that nothing changed. A map of another world or size than
 * `previous` also starts afresh, which covers a baseline that was somehow missed.
 */
export function applyMapDiscovery(
  previous: DungeonMapState | null,
  discovery: MapDiscovery,
): DungeonMapState {
  const continues =
    previous !== null &&
    !discovery.reset &&
    previous.id === discovery.id &&
    previous.width === discovery.width &&
    previous.height === discovery.height;

  if (continues && discovery.discovered.length === 0) return previous;

  const tiles = continues
    ? [...previous.tiles]
    : Array.from({ length: discovery.height }, () => UNKNOWN.repeat(discovery.width));

  for (const run of discovery.discovered) {
    const row = tiles[run.y];
    // A run outside the world is the server's mistake; ignoring it beats corrupting a row.
    if (row === undefined || run.x + run.tiles.length > discovery.width) continue;

    tiles[run.y] = row.slice(0, run.x) + run.tiles + row.slice(run.x + run.tiles.length);
  }

  return {
    id: discovery.id,
    name: discovery.name,
    width: discovery.width,
    height: discovery.height,
    originX: 0,
    originY: 0,
    tiles,
  };
}
