import { describe, expect, it } from "vitest";
import { INTERACT_RANGE, TILE_SCALE } from "../../src/shared/constants/game.js";
import { MAP_PROP_KINDS, MAP_PROP_SIZES } from "../../src/shared/constants/scenery.js";
import { isOpen } from "../../src/shared/game/movement.js";
import { HUB_DUNGEON_ID } from "../../src/server/game/dungeonState.js";
import { takeMapDiscovery, visibilityFrameForPlayer } from "../../src/server/game/visibility.js";
import type { DungeonState, MapProp, Vector2 } from "../../src/shared/types/core.js";
import { testPlayer, testSession } from "./fixtures.js";

function hub() {
  const viewer = testPlayer("viewer", { carryingTorch: false });
  const session = testSession([viewer], HUB_DUNGEON_ID);
  session.location = "hub";
  viewer.position = { ...session.spawnPoints[0]! };
  return { session, viewer };
}

/** Points across a prop's footprint, on a quarter-tile grid so fractional placements are covered. */
function footprint(prop: MapProp): Vector2[] {
  const size = MAP_PROP_SIZES[prop.kind];
  const points: Vector2[] = [];
  for (let y = prop.y; y < prop.y + size.tilesHigh; y += 0.25) {
    for (let x = prop.x; x < prop.x + size.tilesWide; x += 0.25) points.push({ x, y });
  }
  return points;
}

/** World tiles a player can stand on, flooded from where they spawned. */
function reachableFrom(dungeon: DungeonState, start: Vector2): Vector2[] {
  const { map } = dungeon;
  const seen = new Set<number>();
  const queue: Vector2[] = [{ x: Math.round(start.x), y: Math.round(start.y) }];
  const reached: Vector2[] = [];

  while (queue.length > 0) {
    const tile = queue.shift()!;
    const key = tile.y * map.width + tile.x;
    if (seen.has(key) || !isOpen(dungeon, [], tile)) continue;
    seen.add(key);
    reached.push(tile);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      queue.push({ x: tile.x + dx, y: tile.y + dy });
    }
  }

  return reached;
}

describe("the hub's scenery", () => {
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

    // Authored (8, 6) is world tiles 32-35 by 24-27.
    expect(fountain).toMatchObject({ x: 8 * TILE_SCALE, y: 6 * TILE_SCALE });
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
    // The fountain stands on open floor today, so a player still walks over it until the hub layout
    // puts something solid beneath it.
    const fountain = props.find((prop) => prop.kind === "fountain")!;
    expect(isOpen(session.dungeon, [], { x: fountain.x + 2, y: fountain.y + 2 })).toBe(true);
  });

  it("leaves every pickup, the gate and every spawn reachable from the first spawn", () => {
    const { session } = hub();
    const reachable = reachableFrom(session.dungeon, session.spawnPoints[0]!);
    const inReach = (target: Vector2): boolean =>
      reachable.some((tile) => Math.hypot(tile.x - target.x, tile.y - target.y) <= INTERACT_RANGE);

    expect(session.dungeon.loot.length).toBe(6);
    for (const loot of session.dungeon.loot) expect(inReach(loot.position), loot.name).toBe(true);
    expect(session.dungeon.exits).toHaveLength(1);
    for (const exit of session.dungeon.exits) expect(inReach(exit.position)).toBe(true);
    for (const spawn of session.spawnPoints) {
      expect(reachable.some((tile) => tile.x === Math.round(spawn.x) && tile.y === Math.round(spawn.y))).toBe(true);
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
