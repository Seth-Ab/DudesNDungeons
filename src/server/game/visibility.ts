import {
  VOICE_FULL_VOLUME_DISTANCE,
  VOICE_SILENCE_DISTANCE,
} from "../../shared/constants/game.js";
import {
  coversTile,
  distance,
  PLAYER_RADIUS,
  tileAt,
  tileOf,
} from "../../shared/game/movement.js";
import { DEFAULT_MAP_THEME, MAP_PROP_SIZES } from "../../shared/constants/scenery.js";
import type {
  DiscoveredRun,
  DungeonMapState,
  DungeonState,
  DungeonSnapshot,
  LightSourceState,
  LitRun,
  MapDiscovery,
  MapProp,
  PlayerId,
  PlayerState,
  RoomState,
  Vector2,
} from "../../shared/types/core.js";
import type { ServerMessage } from "../../shared/protocol/index.js";
import { rosterOf, withOwnBank, type Session, type SessionPlayer } from "../sessions/sessionStore.js";
import { monsterStatsFor } from "./dungeonState.js";
import { contentForSession, torchLightRadiusFor } from "./progression.js";
import { buildRoomGrid, createDiscoveredGrid, LitTiles, type RoomGrid } from "./tileGrid.js";

export interface VisibilityFrame {
  /** Everything but the map, whose delta is drained once per snapshot by `takeMapDiscovery`. */
  dungeon: Omit<DungeonSnapshot, "map">;
  players: PlayerState[];
  visiblePlayerIds: Set<PlayerId>;
}

interface ActiveLightSource extends LightSourceState {
  origin: Vector2;
}

/** The per-viewer grid of lit tiles, reused every frame so a tick allocates none. */
const litTilesByViewer = new WeakMap<SessionPlayer, LitTiles>();

function litTilesFor(viewer: SessionPlayer, map: DungeonMapState): LitTiles {
  let lit = litTilesByViewer.get(viewer);
  if (!lit || !lit.fits(map.width, map.height)) {
    lit = new LitTiles(map.width, map.height);
    litTilesByViewer.set(viewer, lit);
  }

  return lit.begin();
}

/** Which room each tile is in, built once per dungeon and dropped with its room list. */
const roomGrids = new WeakMap<readonly RoomState[], RoomGrid>();

function roomGridFor(dungeon: DungeonState): RoomGrid {
  let grid = roomGrids.get(dungeon.rooms);
  if (!grid || grid.width !== dungeon.map.width || grid.height !== dungeon.map.height) {
    grid = buildRoomGrid(dungeon.map.width, dungeon.map.height, dungeon.rooms);
    roomGrids.set(dungeon.rooms, grid);
  }

  return grid;
}

/** The viewer's discovery memory, sized for this world. Normally already so; see `resetPlayerForWorld`. */
export function discoveredFor(viewer: SessionPlayer, map: DungeonMapState): Uint8Array {
  if (viewer.discoveredTiles.length !== map.width * map.height) {
    viewer.discoveredTiles = createDiscoveredGrid(map.width, map.height);
  }

  return viewer.discoveredTiles;
}

function tileDiscovered(viewer: SessionPlayer, map: DungeonMapState, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return false;

  return viewer.discoveredTiles[y * map.width + x] === 1;
}

function isOpaque(dungeon: DungeonState, x: number, y: number): boolean {
  const tile = tileAt(dungeon.map, x, y);
  if (tile === null || tile === "#") return true;

  return dungeon.doors.some((door) => !door.open && coversTile(door, x, y));
}

/**
 * Whether nothing solid stands between two points. The target's own tile is never in the way, so a
 * wall you are looking at is lit rather than hidden behind itself.
 *
 * A closed door is one object spread over `TILE_SCALE` squared tiles, so the exemption has to cover
 * the whole of it rather than the single tile the ray was aimed at. Exempting one tile was correct
 * while a door was one tile; once `TILE_SCALE` made it a 4x4 block, the fifteen other tiles of a
 * door sat between the viewer and its centre and blocked sight of it. The door hid behind itself,
 * so `discoveredTiles` never gained its centre tile, and no closed door was ever sent to anyone.
 *
 * Walks the grid one tile boundary at a time rather than sampling the ray at a fixed interval.
 * Sampling was fine when a torch reached four tiles; at `TILE_SCALE` it reaches thirteen, every
 * light covers sixteen times the tiles, and a fixed-interval walk costs five samples per tile
 * crossed for no extra accuracy. This visits each tile the ray actually passes through, exactly
 * once, which is what keeps lighting affordable at the larger scale.
 */
export function hasLineOfSight(dungeon: DungeonState, from: Vector2, to: Vector2): boolean {
  const target = tileOf(to);
  // The closed door the ray is aimed at, if any. Every tile of that one door is the target.
  const targetDoor = dungeon.doors.find(
    (door) => !door.open && coversTile(door, target.x, target.y),
  );
  const reachedTarget = (tileX: number, tileY: number): boolean =>
    (tileX === target.x && tileY === target.y) ||
    (targetDoor !== undefined && coversTile(targetDoor, tileX, tileY));

  let x = Math.round(from.x);
  let y = Math.round(from.y);
  if (reachedTarget(x, y)) return true;

  // A light buried in a wall lights nothing, which is how a fixed-interval walk behaved too.
  if (isOpaque(dungeon, x, y)) return false;

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const stepX = dx >= 0 ? 1 : -1;
  const stepY = dy >= 0 ? 1 : -1;

  // Tile centres sit on integers, so the boundary between tile n and n + 1 is at n + 0.5.
  const deltaX = dx === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / dx);
  const deltaY = dy === 0 ? Number.POSITIVE_INFINITY : Math.abs(1 / dy);
  let nextX = dx === 0 ? Number.POSITIVE_INFINITY : (x + stepX * 0.5 - from.x) / dx;
  let nextY = dy === 0 ? Number.POSITIVE_INFINITY : (y + stepY * 0.5 - from.y) / dy;

  // One crossing per tile of the ray's bounding box, plus slack. A ray cannot need more, and the
  // cap means a degenerate direction can never spin here forever.
  const limit = Math.abs(target.x - x) + Math.abs(target.y - y) + 2;

  for (let crossing = 0; crossing < limit; crossing += 1) {
    if (nextX < nextY) {
      x += stepX;
      nextX += deltaX;
    } else {
      y += stepY;
      nextY += deltaY;
    }

    if (reachedTarget(x, y)) return true;
    if (isOpaque(dungeon, x, y)) return false;
  }

  return true;
}

/**
 * How far past a seen player's body they stay in view, in world units.
 *
 * Players are judged by their whole body rather than by the one tile their centre rounds into, and
 * once seen they stay seen while sight or light still reaches within this much of it. Without the
 * margin, someone walking along the ragged rim of a light or past a corner dropped out and back in
 * every time their rounded tile changed (#61). It is less than the thinnest wall or door at
 * `TILE_SCALE`, and only see-through tiles count, so the margin never reaches into the next room.
 */
const PLAYER_SIGHT_LINGER = 1;

/**
 * The players each viewer saw in their last frame, for the margin above. Keyed weakly by the viewer
 * so a player who leaves takes the memory with them. A frame recomputed for unchanged positions
 * gives the same answer, so computing one more than once a tick is harmless.
 */
const lastSeenPlayers = new WeakMap<SessionPlayer, ReadonlySet<PlayerId>>();

/** How far around another player's centre counts as them, given whether the viewer saw them last. */
function bodyReach(viewer: SessionPlayer, player: SessionPlayer): number {
  const seen = lastSeenPlayers.get(viewer)?.has(player.id) ?? false;
  return PLAYER_RADIUS + (seen ? PLAYER_SIGHT_LINGER : 0);
}

/** Whether `visit` holds for any see-through tile overlapping the box `reach` around `position`. */
function someOpenTileNear(
  dungeon: DungeonState,
  position: Vector2,
  reach: number,
  visit: (x: number, y: number) => boolean,
): boolean {
  const low = tileOf({ x: position.x - reach, y: position.y - reach });
  const high = tileOf({ x: position.x + reach, y: position.y + reach });

  for (let y = low.y; y <= high.y; y += 1) {
    for (let x = low.x; x <= high.x; x += 1) {
      if (!isOpaque(dungeon, x, y) && visit(x, y)) return true;
    }
  }

  return false;
}

/**
 * Whether two bodies have a clear line between them, judged the same from either end.
 *
 * `hasLineOfSight` aims from a point at the centre of a tile, so A-to-B and B-to-A are different
 * rays, and near a corner or a door edge one can clear while the other is blocked. Used alone, that
 * let one player see another's torch while the other could not see theirs back (#61). Here a ray
 * from either eye to any open tile of the other's body counts, so the answer is the same from both
 * ends. It also covers every tile one player's own torch could light on the other's body, which is
 * what keeps two torch carriers seeing each other or neither.
 */
function bodiesInSight(dungeon: DungeonState, a: Vector2, b: Vector2, reach: number): boolean {
  const sees = (eye: Vector2, body: Vector2) =>
    someOpenTileNear(dungeon, body, reach, (x, y) => hasLineOfSight(dungeon, eye, { x, y }));
  return sees(a, b) || sees(b, a);
}

function carriedTorchFor(session: Session, player: SessionPlayer): ActiveLightSource | null {
  if (!player.carryingTorch) return null;

  return {
    id: player.id,
    name: `${player.name}'s Torch`,
    kind: "carriedTorch",
    position: { ...player.position },
    origin: player.position,
    radius: torchLightRadiusFor(player, contentForSession(session)),
  };
}

function activeLightSourcesForPlayer(session: Session, viewer: SessionPlayer): ActiveLightSource[] {
  const sources: ActiveLightSource[] = [];
  const ownTorch = carriedTorchFor(session, viewer);
  if (ownTorch) sources.push(ownTorch);

  for (const light of session.dungeon.lightSources) {
    if (!hasLineOfSight(session.dungeon, viewer.position, light.position)) continue;
    sources.push({ ...light, position: { ...light.position }, origin: light.position });
  }

  // A downed player's torch keeps burning where they fell, so the party can find them to revive or
  // carry them, and so they light the same ground for others as they already did for themselves.
  // A disconnected player's torch goes out with them.
  for (const player of session.players.values()) {
    if (player.id === viewer.id || !player.connected) continue;

    const torch = carriedTorchFor(session, player);
    if (!torch) continue;
    const reach = bodyReach(viewer, player);
    if (!bodiesInSight(session.dungeon, viewer.position, player.position, reach)) continue;
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
  visible = new LitTiles(session.dungeon.map.width, session.dungeon.map.height),
): LitTiles {
  const doors = doorSignature(session.dungeon);

  for (const source of sources) {
    if (source.kind === "fixed") {
      for (const index of fixedLightTiles(session.dungeon, source, doors)) visible.addIndex(index);
    } else {
      lightFrom(session.dungeon, source, visible);
    }
  }

  return visible;
}

/**
 * What each fixed light reveals, per dungeon and per arrangement of open doors.
 *
 * A fixed light never moves, so what it lights changes only when a door does. Raycasting it afresh
 * for every viewer on every tick was the single largest cost on the server: the hub's hearth lights
 * the entire hall, and recomputing that took several milliseconds per player, twenty times a second.
 * Keyed weakly by the map, so a rebuilt world drops its cache along with itself.
 */
const fixedLightCache = new WeakMap<DungeonMapState, Map<string, Int32Array>>();

function doorSignature(dungeon: DungeonState): string {
  return dungeon.doors.map((door) => (door.open ? "1" : "0")).join("");
}

function fixedLightTiles(
  dungeon: DungeonState,
  source: ActiveLightSource,
  doors: string,
): Int32Array {
  let cache = fixedLightCache.get(dungeon.map);
  if (!cache) {
    cache = new Map();
    fixedLightCache.set(dungeon.map, cache);
  }

  const key = `${source.id}|${doors}`;
  let tiles = cache.get(key);
  if (!tiles) {
    const lit = new LitTiles(dungeon.map.width, dungeon.map.height);
    lightFrom(dungeon, source, lit);
    tiles = new Int32Array(lit.size);
    for (let n = 0; n < lit.size; n += 1) tiles[n] = lit.indexAt(n);
    cache.set(key, tiles);
  }

  return tiles;
}

/**
 * Adds what one light reveals to `visible`: every tile in its radius with a clear line to it, and
 * every wall bordering one of those floor tiles.
 *
 * The walls are the second half for a reason. A ray aimed at a wall tile's centre only clears when it
 * meets that tile head on; down a corridor it grazes along the wall and enters the wall row a tile or
 * two early. Judged by rays alone, the walls a few tiles ahead were never lit, so corridors drew as
 * floor hanging in the void and rooms lost every stretch of wall seen at a shallow angle. A wall
 * bordering lit floor is the face of that floor's boundary, and at `TILE_SCALE` every wall is at
 * least four tiles thick, so this never reveals anything on the far side of one.
 */
function lightFrom(dungeon: DungeonState, source: ActiveLightSource, visible: LitTiles): void {
  const { map } = dungeon;
  const minX = Math.max(0, Math.floor(source.origin.x - source.radius));
  const maxX = Math.min(map.width - 1, Math.ceil(source.origin.x + source.radius));
  const minY = Math.max(0, Math.floor(source.origin.y - source.radius));
  const maxY = Math.min(map.height - 1, Math.ceil(source.origin.y + source.radius));

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const index = y * map.width + x;
      // Another source already lit it, and its walls with it; the raycast is the expensive part.
      if (visible.hasIndex(index)) continue;

      const center = { x, y };
      if (distance(source.origin, center) > source.radius) continue;
      if (!hasLineOfSight(dungeon, source.origin, center)) continue;

      visible.addIndex(index);
      if (tileAt(map, x, y) === "#") continue;

      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (tileAt(map, x + dx, y + dy) === "#") visible.addIndex((y + dy) * map.width + x + dx);
        }
      }
    }
  }
}

function tileVisible(visible: LitTiles, position: Vector2): boolean {
  const tile = tileOf(position);
  return visible.hasAt(tile.x, tile.y);
}

/**
 * Files newly lit tiles into the viewer's memory, and notes any room they have now seen part of.
 *
 * Rooms are recorded as they are discovered rather than searched for afterwards. Rescanning every
 * room's tiles each tick was affordable when a room was a hundred tiles; at `TILE_SCALE` one is
 * closer to two thousand, and a party of four would pay for that twenty times a second forever
 * after. A tile is only ever discovered once, so doing the work there costs nothing once a player
 * has stopped exploring.
 */
function recordDiscovery(session: Session, viewer: SessionPlayer, visible: LitTiles): void {
  const discovered = discoveredFor(viewer, session.dungeon.map);

  for (let n = 0; n < visible.size; n += 1) {
    discoverTile(session, viewer, discovered, visible.indexAt(n));
  }
}

/**
 * Files one tile into a viewer's memory if it is new to them: the tile, the room it belongs to, the
 * delta for their next snapshot, and the log other players merge from. Shared by what a player sees
 * and what a nearby player tells them (`mapSharing.ts`), so both reach the client the same way.
 * Returns whether the tile was new.
 */
export function discoverTile(
  session: Session,
  viewer: SessionPlayer,
  discovered: Uint8Array,
  index: number,
): boolean {
  if (discovered[index] === 1) return false;

  const { rooms } = session.dungeon;
  discovered[index] = 1;
  viewer.discoveryLog.push(index);
  if (viewer.mapSyncedTo === session.dungeon.map) viewer.pendingDiscovery.push(index);
  if (rooms.length === 0) return true;

  const grid = roomGridFor(session.dungeon);
  const roomIndex = grid.roomOf[index]!;
  if (roomIndex === -1) return true;

  viewer.discoveredRoomIds.add(rooms[roomIndex]!.id);
  for (const other of grid.overlaps.get(index) ?? []) viewer.discoveredRoomIds.add(rooms[other]!.id);
  return true;
}

function visibleDungeon(
  session: Session,
  viewer: SessionPlayer,
  visible: LitTiles,
  sources: readonly ActiveLightSource[],
): Omit<DungeonSnapshot, "map"> {
  recordDiscovery(session, viewer, visible);

  const { map } = session.dungeon;

  return {
    // A room appears once the player has seen any part of it. Sending the full room list would hand
    // a client the shape of the dungeon - how many rooms, where the boss is - before they explore it.
    rooms: session.dungeon.rooms
      .filter((room) => viewer.discoveredRoomIds.has(room.id))
      .map((room) => ({ ...room })),
    monsters: session.dungeon.monsters
      .filter((monster) => monster.alive && tileVisible(visible, monster.position))
      .map((monster) => ({ ...monster, position: { ...monster.position } })),
    projectiles: session.dungeon.projectiles
      .filter((projectile) => tileVisible(visible, projectile.position))
      .map((projectile) => ({
        ...projectile,
        position: { ...projectile.position },
        direction: { ...projectile.direction },
      })),
    loot: session.dungeon.loot
      .filter((loot) => !loot.pickedUp && tileVisible(visible, loot.position))
      .map((loot) => ({ ...loot, position: { ...loot.position } })),
    chests: session.dungeon.chests
      .filter((chest) => tileVisible(visible, chest.position))
      .map((chest) => ({ ...chest, position: { ...chest.position } })),
    traps: session.dungeon.traps
      .filter((trap) => tileVisible(visible, trap.position))
      .map((trap) => ({ ...trap, position: { ...trap.position } })),
    // A puzzle is sent once any plate is in view, but only with the plates the viewer can see: the
    // far half of a paired puzzle is not on their map until they have looked at it.
    puzzles: session.dungeon.puzzles
      .map((puzzle) => ({
        ...puzzle,
        plates: puzzle.plates
          .filter((plate) => tileVisible(visible, plate.position))
          .map((plate) => ({ ...plate, position: { ...plate.position } })),
      }))
      .filter((puzzle) => puzzle.plates.length > 0),
    doors: session.dungeon.doors
      .filter((door) => {
        const tile = tileOf(door.position);
        return tileDiscovered(viewer, map, tile.x, tile.y);
      })
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
    // The readout rides along, so everyone who can see a dummy sees the same numbers on it.
    dummies: session.dungeon.dummies
      .filter((dummy) => tileVisible(visible, dummy.position))
      .map((dummy) => ({
        ...dummy,
        position: { ...dummy.position },
        attackers: dummy.attackers.map((attacker) => ({ ...attacker })),
      })),
  };
}

function runsOf(map: DungeonMapState, indexes: ArrayLike<number>): DiscoveredRun[] {
  const runs: DiscoveredRun[] = [];
  let open: DiscoveredRun | null = null;
  let next = -1;

  for (let n = 0; n < indexes.length; n += 1) {
    const index = indexes[n]!;
    const x = index % map.width;
    const y = (index - x) / map.width;
    const tile = map.tiles[y]?.[x] === "#" ? "#" : ".";

    if (open !== null && index === next && x !== 0) {
      open.tiles += tile;
    } else {
      open = { x, y, tiles: tile };
      runs.push(open);
    }
    next = index + 1;
  }

  return runs;
}

/**
 * The tiles the viewer's last frame lit, as row runs in index order. Empty when no frame has been
 * computed for this world yet, so a client never mistakes the last world's light for this one's.
 */
function litRunsFor(viewer: SessionPlayer, map: DungeonMapState): LitRun[] {
  const lit = litTilesByViewer.get(viewer);
  if (!lit || !lit.fits(map.width, map.height) || lit.size === 0) return [];

  const indexes = new Int32Array(lit.size);
  for (let n = 0; n < lit.size; n += 1) indexes[n] = lit.indexAt(n);
  indexes.sort();

  const runs: LitRun[] = [];
  let open: LitRun | null = null;
  for (let n = 0; n < indexes.length; n += 1) {
    const index = indexes[n]!;
    const x = index % map.width;
    if (open !== null && index === open[1] * map.width + open[0] + open[2] && x !== 0) {
      open[2] += 1;
    } else {
      open = [x, (index - x) / map.width, 1];
      runs.push(open);
    }
  }

  return runs;
}

/**
 * The map half of a snapshot: the geometry this viewer has discovered since their last one, and
 * what their light reaches right now.
 *
 * Draining, not pure, so call it exactly once per snapshot actually sent, after the frame that
 * records what the viewer discovered. A viewer whose client holds no baseline for the installed
 * world gets one, `reset` set, carrying everything they have discovered; after that each snapshot
 * carries only the tiles discovered since. Nothing undiscovered is ever sent, so what a client
 * learns of the dungeon is still exactly what its player has seen.
 *
 * `lit` is the whole of the viewer's last frame (`visibilityFrameForPlayer`), not a delta: only
 * their own lights count, so geometry an ally shared with them stays dark until they light it.
 */
export function takeMapDiscovery(session: Session, viewer: SessionPlayer): MapDiscovery {
  const { map } = session.dungeon;
  const discovered = discoveredFor(viewer, map);
  const reset = viewer.mapSyncedTo !== map;

  let indexes: ArrayLike<number>;
  if (reset) {
    const all: number[] = [];
    for (let index = 0; index < discovered.length; index += 1) {
      if (discovered[index] === 1) all.push(index);
    }
    indexes = all;
  } else {
    indexes = Int32Array.from(viewer.pendingDiscovery).sort();
  }

  viewer.pendingDiscovery = [];
  viewer.mapSyncedTo = map;

  const props = map.props && map.props.length > 0 ? propsDiscovered(map, discovered, reset ? null : indexes) : [];

  return {
    id: map.id,
    name: map.name,
    width: map.width,
    height: map.height,
    reset,
    discovered: runsOf(map, indexes),
    lit: litRunsFor(viewer, map),
    ...(map.theme && map.theme !== DEFAULT_MAP_THEME ? { theme: map.theme } : {}),
    ...(props.length > 0 ? { props } : {}),
  };
}

/**
 * The props a snapshot should carry: on a baseline (`fresh` null), every prop with any tile of its
 * footprint discovered; otherwise only those whose first discovered tiles are among `fresh`, so each
 * prop reaches a client exactly once. Scenery, so a prop is sent whole the moment any of it is seen.
 */
function propsDiscovered(
  map: DungeonMapState,
  discovered: Uint8Array,
  fresh: ArrayLike<number> | null,
): MapProp[] {
  if (fresh !== null && fresh.length === 0) return [];
  const isFresh = fresh === null ? null : new Set(Array.from(fresh));
  const found: MapProp[] = [];

  for (const prop of map.props ?? []) {
    const size = MAP_PROP_SIZES[prop.kind];
    const left = Math.max(0, Math.floor(prop.x));
    const top = Math.max(0, Math.floor(prop.y));
    const right = Math.min(map.width, Math.ceil(prop.x + size.tilesWide));
    const bottom = Math.min(map.height, Math.ceil(prop.y + size.tilesHigh));
    let seenNow = false;
    let seenBefore = false;

    for (let y = top; y < bottom && !seenBefore; y += 1) {
      for (let x = left; x < right; x += 1) {
        const index = y * map.width + x;
        if (discovered[index] !== 1) continue;
        if (isFresh === null || isFresh.has(index)) {
          seenNow = true;
        } else {
          seenBefore = true;
          break;
        }
      }
    }

    if (seenNow && !seenBefore) found.push({ ...prop });
  }

  return found;
}

/**
 * `roster` is the session's public player states for this tick. The tick loop builds it once and
 * passes it to every viewer; it is only rebuilt here for callers outside the loop.
 */
export function visibilityFrameForPlayer(
  session: Session,
  viewer: SessionPlayer,
  roster: readonly PlayerState[] = rosterOf(session),
): VisibilityFrame {
  // Computed once and threaded through: gathering sources walks every light, player, and monster in
  // the dungeon, and the frame needs the same answer three times.
  const sources = activeLightSourcesForPlayer(session, viewer);
  const visible = visibleTilesForPlayer(
    session,
    viewer,
    sources,
    litTilesFor(viewer, session.dungeon.map),
  );
  // A player is seen when light falls on any open tile of their body, or near it if they were seen
  // last frame. Their own torch lights their own tile, so a torch in sight is a player in sight.
  const visiblePlayerIds = new Set<PlayerId>([viewer.id]);
  for (const player of session.players.values()) {
    if (player.id === viewer.id) continue;

    const lit = someOpenTileNear(session.dungeon, player.position, bodyReach(viewer, player), (x, y) =>
      visible.hasAt(x, y),
    );
    if (lit) visiblePlayerIds.add(player.id);
  }
  lastSeenPlayers.set(viewer, visiblePlayerIds);

  return {
    dungeon: visibleDungeon(session, viewer, visible, sources),
    // The roster is shared across viewers, so only the viewer's own entry is copied to add the bank.
    players: roster
      .filter((player) => visiblePlayerIds.has(player.id))
      .map((player) => (player.id === viewer.id ? withOwnBank(player, viewer) : player)),
    visiblePlayerIds,
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
