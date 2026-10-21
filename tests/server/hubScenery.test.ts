import { describe, expect, it } from "vitest";
import { INTERACT_RANGE, TILE_SCALE } from "../../src/shared/constants/game.js";
import { MAP_PROP_KINDS, MAP_PROP_SIZES } from "../../src/shared/constants/scenery.js";
import { isOpen, MOVE_INTERVAL_MS, tileAt, tileOf } from "../../src/shared/game/movement.js";
import { HUB_DUNGEON_ID, movePlayer } from "../../src/server/game/dungeonState.js";
import { pickupItem } from "../../src/server/game/items.js";
import { takeMapDiscovery, visibilityFrameForPlayer } from "../../src/server/game/visibility.js";
import type { DungeonState, MapProp, MapPropKind, Vector2 } from "../../src/shared/types/core.js";
import { testPlayer, testSession } from "./fixtures.js";

function hub() {
  const viewer = testPlayer("viewer", { carryingTorch: false });
  const session = testSession([viewer], HUB_DUNGEON_ID);
  session.location = "hub";
  viewer.position = { ...session.spawnPoints[0]! };
  return { session, viewer };
}

/**
 * Points across the box a prop's sprite is drawn in, one in the middle of each quarter-tile cell.
 * A prop's `x`/`y` is the world tile at its top-left, and tile `n` covers `n - 0.5` to `n + 0.5`.
 */
function footprint(prop: MapProp): Vector2[] {
  const size = MAP_PROP_SIZES[prop.kind];
  const points: Vector2[] = [];
  for (let y = prop.y - 0.5 + 0.125; y < prop.y - 0.5 + size.tilesHigh; y += 0.25) {
    for (let x = prop.x - 0.5 + 0.125; x < prop.x - 0.5 + size.tilesWide; x += 0.25) points.push({ x, y });
  }
  return points;
}

/** World tiles a player can stand on, flooded from where they spawned, as `y * width + x`. */
function reachableFrom(dungeon: DungeonState, start: Vector2): Set<number> {
  const { map } = dungeon;
  const seen = new Set<number>();
  const reached = new Set<number>();
  const queue: Vector2[] = [tileOf(start)];

  while (queue.length > 0) {
    const tile = queue.shift()!;
    const key = tile.y * map.width + tile.x;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!isOpen(dungeon, [], tile)) continue;
    reached.add(key);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      queue.push({ x: tile.x + dx, y: tile.y + dy });
    }
  }

  return reached;
}

/**
 * Whether a player who can stand on `reachable` gets within `INTERACT_RANGE` of `target`. Searched
 * on a fine grid rather than by tile centre, because a counter's pickups sit an arm's length from
 * the edge of the floor in front of it, not a whole tile.
 */
function inReach(dungeon: DungeonState, reachable: Set<number>, target: Vector2): Vector2 | null {
  const { width } = dungeon.map;
  for (let y = target.y - INTERACT_RANGE; y <= target.y + INTERACT_RANGE; y += 0.05) {
    for (let x = target.x - INTERACT_RANGE; x <= target.x + INTERACT_RANGE; x += 0.05) {
      const tile = tileOf({ x, y });
      if (Math.hypot(x - target.x, y - target.y) > INTERACT_RANGE) continue;
      if (reachable.has(tile.y * width + tile.x) && isOpen(dungeon, [], { x, y })) return { x, y };
    }
  }
  return null;
}

/** Kinds drawn as something solid standing on the ground, which a player must not walk through. */
const SOLID_KINDS: readonly MapPropKind[] = [
  "fountain",
  "stall",
  "quest-board",
  "tree",
  "bush",
  "sign",
  "bench",
  "log",
];

/** The middle of the edge a stall's counter faces, where a customer stands. */
function counterFront(stall: MapProp): Vector2 {
  const size = MAP_PROP_SIZES.stall;
  const x = stall.x - 0.5 + size.tilesWide / 2;
  return stall.facing === "north" ? { x, y: stall.y - 0.5 } : { x, y: stall.y - 0.5 + size.tilesHigh };
}

/**
 * Walks a player at `target` from `start` for a few seconds and reports every tile they stood on.
 * Uses the server's own move, so it is the movement rule under test, not a copy of it.
 */
function walk(start: Vector2, target: Vector2): Vector2[] {
  const { session, viewer } = hub();
  viewer.position = { ...start };
  const visited: Vector2[] = [];
  let now = 0;
  for (let step = 0; step < 100; step += 1) {
    now += MOVE_INTERVAL_MS;
    movePlayer(session, viewer.id, { x: target.x - viewer.position.x, y: target.y - viewer.position.y }, now);
    visited.push(tileOf(viewer.position));
  }
  return visited;
}

describe("the hub's layout", () => {
  it("draws as forest and places every prop kind at least once", () => {
    const { session } = hub();
    const { map } = session.dungeon;
    const kinds = new Set((map.props ?? []).map((prop) => prop.kind));

    expect(map.theme).toBe("forest");
    for (const kind of MAP_PROP_KINDS) expect(kinds).toContain(kind);
  });

  it("scales props to the world tile at their top-left", () => {
    const { session } = hub();
    const fountain = session.dungeon.map.props?.find((prop) => prop.kind === "fountain");

    // Authored (10, 6), three tiles square, is world tiles 40-51 by 24-35.
    expect(fountain).toMatchObject({ x: 10 * TILE_SCALE, y: 6 * TILE_SCALE });
  });

  it("never changes collision", () => {
    const { session } = hub();
    const props = session.dungeon.map.props ?? [];
    const points = props.flatMap(footprint);
    const before = points.map((point) => isOpen(session.dungeon, [], point));

    session.dungeon.map.props = [];
    const after = points.map((point) => isOpen(session.dungeon, [], point));

    expect(props.length).toBeGreaterThan(0);
    expect(after).toEqual(before);
  });

  it("stands every solid-looking prop on solid tiles, so nothing looks solid where a player can walk", () => {
    const { session } = hub();
    const { dungeon } = session;
    const exit = dungeon.exits[0]!.position;
    const half = TILE_SCALE / 2;

    for (const prop of dungeon.map.props ?? []) {
      // A hanging lantern hangs from an awning, and a campfire pit is a ring of stones flat on the
      // ground, round a light that has to stand on open floor to shine. Everything else stands up.
      if (prop.kind === "hanging-lantern" || prop.kind === "campfire") continue;
      // The gate's archway is the exit, which the party walks into; its pillars and lintel are not.
      const points =
        prop.kind === "dungeon-gate"
          ? footprint(prop).filter((point) => Math.abs(point.x - exit.x) > half || Math.abs(point.y - exit.y) > half)
          : footprint(prop);
      const open = points.filter((point) => isOpen(dungeon, [], point));

      if (prop.kind !== "dungeon-gate") expect(SOLID_KINDS).toContain(prop.kind);
      expect(open, `${prop.kind} at (${prop.x}, ${prop.y})`).toEqual([]);
    }
  });

  it("stops a player walking into the fountain, a counter, a bench, a tree or the forest", () => {
    const { session } = hub();
    const props = session.dungeon.map.props ?? [];
    const [spawn] = session.spawnPoints;
    const reachable = reachableFrom(session.dungeon, spawn!);
    const { width } = session.dungeon.map;
    const targets: { name: string; tiles: Set<number> }[] = [];

    for (const kind of ["fountain", "stall", "bench", "tree"] as const) {
      for (const prop of props.filter((candidate) => candidate.kind === kind)) {
        const tiles = new Set(footprint(prop).map((point) => tileOf(point)).map((tile) => tile.y * width + tile.x));
        targets.push({ name: `${kind} at (${prop.x}, ${prop.y})`, tiles });
      }
    }
    // The forest: the hub's west edge, a whole authored tile deep, beside the campfire clearing.
    const forest = new Set<number>();
    for (let y = 0; y < session.dungeon.map.height; y += 1) {
      for (let x = 0; x < TILE_SCALE; x += 1) forest.add(y * width + x);
    }
    targets.push({ name: "the forest", tiles: forest });

    for (const { name, tiles } of targets) {
      // Approach from the nearest floor tile beside it and push straight at its middle.
      const keys = [...tiles];
      const middle = {
        x: keys.reduce((sum, key) => sum + (key % width), 0) / keys.length,
        y: keys.reduce((sum, key) => sum + Math.floor(key / width), 0) / keys.length,
      };
      const starts = [...reachable]
        .map((key) => ({ x: key % width, y: Math.floor(key / width) }))
        .filter((tile) =>
          [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => tiles.has((tile.y + dy!) * width + tile.x + dx!)),
        )
        .sort((a, b) => Math.hypot(a.x - middle.x, a.y - middle.y) - Math.hypot(b.x - middle.x, b.y - middle.y));
      expect(starts.length, `${name} has floor beside it`).toBeGreaterThan(0);

      const visited = walk(starts[0]!, middle);
      expect(visited.filter((tile) => tiles.has(tile.y * width + tile.x)), name).toEqual([]);
    }
  });

  it("leaves every floor tile, pickup, counter, side corner and the exit reachable from every spawn", () => {
    const { session } = hub();
    const { dungeon } = session;
    const { map } = dungeon;
    const props = map.props ?? [];

    expect(session.spawnPoints).toHaveLength(4);
    expect(dungeon.loot.length).toBe(7);
    expect(dungeon.exits).toHaveLength(1);
    const stalls = props.filter((prop) => prop.kind === "stall");
    expect(stalls.map((stall) => stall.label)).toEqual(["Torch Supply", "Weapons", "Scrolls", "Bank", "Wardrobe"]);
    const corners = ["Campfire Clearing", "Training Yard"].map((name) => dungeon.rooms.find((room) => room.name === name)!);
    expect(corners.every(Boolean)).toBe(true);

    for (const spawn of session.spawnPoints) {
      const reachable = reachableFrom(dungeon, spawn);
      const label = `from (${spawn.x}, ${spawn.y})`;

      // No pockets: anything a player could stand on, they can walk to.
      for (let y = 0; y < map.height; y += 1) {
        for (let x = 0; x < map.width; x += 1) {
          if (map.tiles[y]![x] === ".") expect(reachable.has(y * map.width + x), `(${x}, ${y}) ${label}`).toBe(true);
        }
      }
      for (const loot of dungeon.loot) expect(inReach(dungeon, reachable, loot.position), `${loot.name} ${label}`).not.toBeNull();
      for (const stall of stalls) {
        expect(inReach(dungeon, reachable, counterFront(stall)), `${stall.label}'s counter ${label}`).not.toBeNull();
      }
      for (const room of corners) {
        let floor = 0;
        for (let y = room.y; y < room.y + room.height; y += 1) {
          for (let x = room.x; x < room.x + room.width; x += 1) if (reachable.has(y * map.width + x)) floor += 1;
        }
        // Somewhere to gather: at least a few authored tiles of open ground, not a squeeze.
        expect(floor, `${room.name} ${label}`).toBeGreaterThanOrEqual(6 * TILE_SCALE * TILE_SCALE);
      }
      for (const exit of dungeon.exits) expect(inReach(dungeon, reachable, exit.position), label).not.toBeNull();
    }
  });

  it("lets a player take each pickup from in front of its counter", () => {
    for (const { id } of hub().session.dungeon.loot) {
      const { session, viewer } = hub();
      const loot = session.dungeon.loot.find((candidate) => candidate.id === id)!;
      const standing = inReach(session.dungeon, reachableFrom(session.dungeon, viewer.position), loot.position)!;
      viewer.position = standing;

      expect(pickupItem(session, viewer.id, loot.id), loot.name).toMatchObject({ ok: true });
      expect(loot.pickedUp).toBe(true);
    }
  });

  it("lays the pickups on the counters of the stalls that sell them", () => {
    const { session } = hub();
    const stalls = (session.dungeon.map.props ?? []).filter((prop) => prop.kind === "stall");
    const onCounter = (position: Vector2): string | undefined =>
      stalls.find((stall) =>
        footprint(stall).some((point) => Math.abs(point.x - position.x) < 0.2 && Math.abs(point.y - position.y) < 0.2),
      )?.label;

    for (const loot of session.dungeon.loot) {
      expect(onCounter(loot.position), loot.name).toBe(loot.kind === "torch" ? "Torch Supply" : "Weapons");
    }
  });

  it("keeps the strip in front of the gate clear, four authored tiles wide", () => {
    const { session } = hub();
    const exit = session.dungeon.exits[0]!.position;
    // The authored row below the exit, centred on it.
    const row = exit.y + TILE_SCALE;
    for (let x = exit.x - 2 * TILE_SCALE; x <= exit.x + 2 * TILE_SCALE; x += 1) {
      expect(isOpen(session.dungeon, [], { x, y: row }), `(${x}, ${row})`).toBe(true);
    }
    const props = session.dungeon.map.props ?? [];
    const lights = session.dungeon.lightSources;
    const onStrip = (point: Vector2) =>
      Math.abs(point.x - exit.x) <= 2 * TILE_SCALE && Math.abs(point.y - row) <= TILE_SCALE / 2;
    expect(props.filter((prop) => footprint(prop).some(onStrip))).toEqual([]);
    expect(lights.filter((light) => onStrip(light.position))).toEqual([]);
  });

  it("shows the fountain and two whole stalls from every spawn on a 1600x900 screen", () => {
    const { session } = hub();
    const props = session.dungeon.map.props ?? [];
    // The renderer draws 32 pixels per world unit, centred on the player.
    const halfWidth = 1600 / 32 / 2;
    const halfHeight = 900 / 32 / 2;

    for (const spawn of session.spawnPoints) {
      const onScreen = (prop: MapProp): boolean => {
        const size = MAP_PROP_SIZES[prop.kind];
        return (
          prop.x - 0.5 >= spawn.x - halfWidth &&
          prop.x - 0.5 + size.tilesWide <= spawn.x + halfWidth &&
          prop.y - 0.5 >= spawn.y - halfHeight &&
          prop.y - 0.5 + size.tilesHigh <= spawn.y + halfHeight
        );
      };
      expect(props.filter((prop) => prop.kind === "fountain" && onScreen(prop))).toHaveLength(1);
      expect(props.filter((prop) => prop.kind === "stall" && onScreen(prop)).length).toBeGreaterThanOrEqual(2);
    }
  });

  it("sends the theme on every discovery and each prop once, with the first of its tiles", () => {
    const { session, viewer } = hub();
    // Nothing discovered yet: the baseline carries the theme and no props.
    const baseline = takeMapDiscovery(session, viewer);
    expect(baseline.reset).toBe(true);
    expect(baseline.theme).toBe("forest");
    expect(baseline.props).toBeUndefined();

    const { map } = session.dungeon;
    const fountain = map.props!.find((prop) => prop.kind === "fountain")!;
    const corner = fountain.y * map.width + fountain.x;
    viewer.discoveredTiles[corner] = 1;
    viewer.pendingDiscovery.push(corner);
    expect(takeMapDiscovery(session, viewer).props).toEqual([fountain]);

    // More of the same fountain is not news.
    viewer.discoveredTiles[corner + 1] = 1;
    viewer.pendingDiscovery.push(corner + 1);
    const later = takeMapDiscovery(session, viewer);
    expect(later.props).toBeUndefined();
    expect(later.theme).toBe("forest");
  });

  it("resends every prop the viewer knows of on a reset", () => {
    const { session, viewer } = hub();
    visibilityFrameForPlayer(session, viewer);
    const first = takeMapDiscovery(session, viewer);
    const known = first.props ?? [];
    expect(known.length).toBeGreaterThan(0);

    visibilityFrameForPlayer(session, viewer);
    expect(takeMapDiscovery(session, viewer).props).toBeUndefined();

    // A reconnect clears the sync point, and the baseline that follows carries them all again.
    viewer.mapSyncedTo = null;
    const rebased = takeMapDiscovery(session, viewer);
    expect(rebased.reset).toBe(true);
    expect(rebased.props).toEqual(known);
  });

  it("leaves generated dungeons in stone with no props", () => {
    const session = testSession([testPlayer("viewer")]);
    const viewer = session.players.get("viewer")!;
    visibilityFrameForPlayer(session, viewer);
    const discovery = takeMapDiscovery(session, viewer);

    expect(session.dungeon.map.theme ?? "stone").toBe("stone");
    expect(session.dungeon.map.props ?? []).toEqual([]);
    expect(discovery.theme).toBeUndefined();
    expect(discovery.props).toBeUndefined();
  });
});

describe("the hub's ground", () => {
  it("scales its ground grid with the tiles, a block per authored tile", () => {
    const { session } = hub();
    const { map } = session.dungeon;

    expect(map.ground).toHaveLength(map.height);
    for (const row of map.ground ?? []) expect(row).toHaveLength(map.width);
    // Authored (11, 7) is cobble under the fountain; authored (3, 3) is grass; authored (19, 4) is
    // the training yard's dirt.
    expect(map.ground?.[7 * TILE_SCALE + 1]?.[11 * TILE_SCALE + 2]).toBe("c");
    expect(map.ground?.[3 * TILE_SCALE + 3]?.[3 * TILE_SCALE]).toBe("g");
    expect(map.ground?.[4 * TILE_SCALE]?.[19 * TILE_SCALE + 3]).toBe("d");
  });

  it("covers every floor tile with grass, cobble or dirt, and what each solid prop stands on", () => {
    const { session } = hub();
    const { map } = session.dungeon;

    for (let y = 0; y < map.height; y += 1) {
      for (let x = 0; x < map.width; x += 1) {
        if (map.tiles[y]![x] === ".") expect("gcd").toContain(map.ground![y]![x]);
      }
    }
    // A solid prop's tiles carry ground, so they draw as the plaza or grass it stands on rather
    // than as forest. The gate is built into the forest, and a bush may grow at its edge.
    for (const prop of map.props ?? []) {
      if (prop.kind === "dungeon-gate" || prop.kind === "hanging-lantern") continue;
      if (prop.kind === "bush" && footprint(prop).every((point) => map.ground![tileOf(point).y]![tileOf(point).x] === ".")) {
        continue;
      }
      for (const point of footprint(prop)) {
        const tile = tileOf(point);
        expect("gcd", `${prop.kind} at (${prop.x}, ${prop.y})`).toContain(map.ground![tile.y]![tile.x]);
      }
    }
  });

  it("never changes collision", () => {
    const { session } = hub();
    const { map } = session.dungeon;
    // Each tile's centre and two points near its corners, so the edge of a block is covered too.
    const points: Vector2[] = [];
    for (let y = 0; y < map.height; y += 1) {
      for (let x = 0; x < map.width; x += 1) {
        for (const [dx, dy] of [[0, 0], [-0.4, -0.4], [0.4, 0.4]] as const) points.push({ x: x + dx, y: y + dy });
      }
    }
    const before = points.map((point) => isOpen(session.dungeon, [], point));
    const allGrass = map.ground!.map((row) => "g".repeat(row.length));

    delete map.ground;
    expect(points.map((point) => isOpen(session.dungeon, [], point))).toEqual(before);
    map.ground = allGrass;
    expect(points.map((point) => isOpen(session.dungeon, [], point))).toEqual(before);
  });

  it("sends ground with the runs it describes, and only where the map has some", () => {
    const { session, viewer } = hub();
    visibilityFrameForPlayer(session, viewer);
    const { discovered } = takeMapDiscovery(session, viewer);
    const { map } = session.dungeon;

    expect(discovered.some((run) => run.ground !== undefined)).toBe(true);
    for (const run of discovered) {
      const expected = map.ground![run.y]!.slice(run.x, run.x + run.tiles.length);
      if (run.ground !== undefined) expect(run.ground).toBe(expected);
      else expect(expected).toMatch(/^\.+$/);
    }
  });

  it("sends no ground for a dungeon without a ground grid", () => {
    const session = testSession([testPlayer("viewer")]);
    const viewer = session.players.get("viewer")!;
    visibilityFrameForPlayer(session, viewer);
    const { discovered } = takeMapDiscovery(session, viewer);

    expect(session.dungeon.map.ground).toBeUndefined();
    expect(discovered.length).toBeGreaterThan(0);
    expect(discovered.every((run) => run.ground === undefined)).toBe(true);
  });

  it("gives each stall an awning colour (the Scrolls stall repeats one, as there are four), and turns the southern stalls and benches to face north", () => {
    const { session } = hub();
    const props = session.dungeon.map.props ?? [];
    const stalls = props.filter((prop) => prop.kind === "stall");
    const fountain = props.find((prop) => prop.kind === "fountain")!;
    const middle = fountain.y - 0.5 + MAP_PROP_SIZES.fountain.tilesHigh / 2;

    expect(stalls.map((stall) => stall.tint)).toEqual(["ember", "azure", "plum", "moss", "plum"]);
    // Everything that faces the fountain from the south of it is turned round to face it.
    for (const prop of props.filter((candidate) => candidate.kind === "stall" || candidate.kind === "bench")) {
      expect(prop.facing ?? "south", `${prop.kind} at (${prop.x}, ${prop.y})`).toBe(prop.y > middle ? "north" : "south");
    }
  });
});

describe("the hub's lights", () => {
  it("gives each light its own id and a campfire that flickers hardest", () => {
    const { session } = hub();
    const lights = session.dungeon.lightSources;
    const flickers = lights.map((light) => light.flicker ?? 0);

    expect(new Set(lights.map((light) => light.id)).size).toBe(lights.length);
    expect(lights.filter((light) => (light.fixture ?? "pillar") === "pillar").length).toBeGreaterThanOrEqual(5);
    const campfire = lights.find((light) => light.fixture === "campfire")!;
    expect(campfire.flicker).toBe(Math.max(...flickers));
  });

  it("stands every light on open floor, because a light inside a wall shines on nothing", () => {
    for (const light of hub().session.dungeon.lightSources) {
      const { session, viewer } = hub();
      const tile = tileOf(light.position);
      expect(tileAt(session.dungeon.map, tile.x, tile.y), light.name).not.toBe("#");

      // And so it reaches a player standing under it: the campfire draws its flame from this.
      viewer.position = { ...light.position };
      const sent = visibilityFrameForPlayer(session, viewer).dungeon.lightSources;
      expect(sent.map((source) => source.id), light.name).toContain(light.id);
    }
  });

  it("names the stalls, the quest board, the fountain and the training yard", () => {
    const { session } = hub();
    const labels = (session.dungeon.map.props ?? []).flatMap((prop) => (prop.label ? [prop.label] : []));

    expect(labels).toEqual(
      expect.arrayContaining([
        "Torch Supply",
        "Weapons",
        "Scrolls",
        "Bank",
        "Wardrobe",
        "Quest Gallery",
        "Strategy Hearth",
        "Training Yard",
      ]),
    );
  });
});
