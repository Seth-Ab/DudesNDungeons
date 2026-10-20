import { DEFAULT_GROUND } from "../../shared/constants/scenery.js";
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
 * `previous` also starts afresh, which covers a baseline that was somehow missed. Props, seats and
 * ready plates accumulate the same way as tiles, and the theme rides along with every delta.
 *
 * Ground is held only once a run has carried some, so a map without a ground grid never grows one.
 * A run without ground on a map that has it is all theme floor (`.`).
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

  const newProps = discovery.props ?? [];
  const newSeats = discovery.seats ?? [];
  const newPlates = discovery.readyPlates ?? [];
  if (
    continues &&
    discovery.discovered.length === 0 &&
    newProps.length === 0 &&
    newSeats.length === 0 &&
    newPlates.length === 0
  ) {
    return previous;
  }

  const blank = (): string[] => Array.from({ length: discovery.height }, () => UNKNOWN.repeat(discovery.width));
  const tiles = continues ? [...previous.tiles] : blank();
  const previousGround = continues ? previous.ground : undefined;
  let ground = previousGround ? [...previousGround] : null;

  for (const run of discovery.discovered) {
    const row = tiles[run.y];
    // A run outside the world is the server's mistake; ignoring it beats corrupting a row.
    if (row === undefined || run.x + run.tiles.length > discovery.width) continue;

    tiles[run.y] = splice(row, run.x, run.tiles);
    if (run.ground === undefined && ground === null) continue;

    if (ground === null) {
      // The first ground to arrive: every tile discovered before it was plain theme floor.
      ground = tiles.map((line) => line.replace(/[^ ]/g, DEFAULT_GROUND));
    }
    ground[run.y] = splice(ground[run.y] ?? "", run.x, run.ground ?? DEFAULT_GROUND.repeat(run.tiles.length));
  }

  const readyPlates = continues ? [...(previous.readyPlates ?? []), ...newPlates] : newPlates;

  return {
    id: discovery.id,
    name: discovery.name,
    width: discovery.width,
    height: discovery.height,
    originX: 0,
    originY: 0,
    tiles,
    ...(discovery.theme ? { theme: discovery.theme } : {}),
    // A prop arrives once, so a continuing map keeps what it had and adds what is new.
    props: continues ? [...(previous.props ?? []), ...newProps] : newProps,
    // Seats arrive once each too, with their tile.
    seats: continues ? [...(previous.seats ?? []), ...newSeats] : newSeats,
    // And ready plates, which only the hub has, so a map without any never grows the field.
    ...(readyPlates.length > 0 ? { readyPlates } : {}),
    ...(ground ? { ground } : {}),
  };
}

function splice(row: string, at: number, text: string): string {
  return row.slice(0, at) + text + row.slice(at + text.length);
}
