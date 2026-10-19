import { describe, expect, it } from "vitest";
import { INTERACT_RANGE, TILE_SCALE } from "../../src/shared/constants/game.js";
import { MAP_PROP_SIZES } from "../../src/shared/constants/scenery.js";
import { isOpen, PLAYER_STEP_DISTANCE, tileAt } from "../../src/shared/game/movement.js";
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

/** Every world tile a prop's sprite covers. */
function footprint(prop: MapProp): Vector2[] {
  const size = MAP_PROP_SIZES[prop.kind];
  const tiles: Vector2[] = [];
  for (let y = prop.y; y < prop.y + size.tilesHigh; y += 1) {
    for (let x = prop.x; x < prop.x + size.tilesWide; x += 1) tiles.push({ x, y });
  }
  return tiles;
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
  it("draws as forest and ships the market's props, labelled", () => {
    const { session } = hub();
    const { map } = session.dungeon;
    const props = map.props ?? [];
    const kinds = new Set(props.map((prop) => prop.kind));

    expect(map.theme).toBe("forest");
    for (const kind of ["fountain", "stall", "quest-board", "tree", "dungeon-gate", "grass"]) {
      expect(kinds).toContain(kind);
    }
    const labels = props.flatMap((prop) => (prop.label ? [prop.label] : []));
    expect(labels).toEqual(expect.arrayContaining(["Torches", "Weapons", "Quest Board (empty)"]));
    expect(labels.some((label) => label.startsWith("Bank"))).toBe(true);
    expect(labels.some((label) => label.startsWith("Wardrobe"))).toBe(true);
  });

  it("scales props to the world tile at their top-left", () => {
    const { session } = hub();
    const fountain = session.dungeon.map.props?.find((prop) => prop.kind === "fountain");

    // Authored (9, 6) is world tiles 36-39 by 24-27.
    expect(fountain).toMatchObject({ x: 9 * TILE_SCALE, y: 6 * TILE_SCALE });
  });

  it("puts something solid under every fountain, stall, board and tree", () => {
    const { session } = hub();
    const solid = (session.dungeon.map.props ?? []).filter((prop) =>
      ["fountain", "stall", "quest-board", "tree"].includes(prop.kind),
    );

    expect(solid.length).toBeGreaterThan(0);
    for (const prop of solid) {
      for (const tile of footprint(prop)) {
        expect(tileAt(session.dungeon.map, tile.x, tile.y), `${prop.kind} at ${tile.x},${tile.y}`).toBe("#");
      }
    }
  });

  it("does not let a player walk into the fountain, a stall counter or the forest", () => {
    const { session } = hub();
    const fountain = session.dungeon.map.props!.find((prop) => prop.kind === "fountain")!;
    // Standing just south of the basin and stepping north.
    const below: Vector2 = { x: fountain.x + 2, y: fountain.y + 4.4 };

    expect(isOpen(session.dungeon, [], below)).toBe(true);
    expect(isOpen(session.dungeon, [], { x: below.x, y: below.y - PLAYER_STEP_DISTANCE * 4 })).toBe(false);

    const reachable = reachableFrom(session.dungeon, session.spawnPoints[0]!);
    const blocked = new Set(
      (session.dungeon.map.props ?? [])
        .filter((prop) => ["fountain", "stall", "quest-board", "tree"].includes(prop.kind))
        .flatMap(footprint)
        .map((tile) => `${tile.x},${tile.y}`),
    );
    for (const tile of reachable) {
      expect(blocked.has(`${tile.x},${tile.y}`)).toBe(false);
      expect(tileAt(session.dungeon.map, tile.x, tile.y)).toBe(".");
    }
  });

  it("leaves every pickup and the gate within reach of open floor joined to spawn", () => {
    const { session } = hub();
    const reachable = reachableFrom(session.dungeon, session.spawnPoints[0]!);
    const inReach = (target: Vector2): boolean =>
      reachable.some((tile) => Math.hypot(tile.x - target.x, tile.y - target.y) <= INTERACT_RANGE);

    expect(session.dungeon.loot.length).toBe(6);
    for (const loot of session.dungeon.loot) expect(inReach(loot.position), loot.name).toBe(true);
    for (const exit of session.dungeon.exits) expect(inReach(exit.position)).toBe(true);
    // Every spawn point is on the same stretch of floor as the first.
    for (const spawn of session.spawnPoints) {
      expect(reachable.some((tile) => tile.x === Math.round(spawn.x) && tile.y === Math.round(spawn.y))).toBe(true);
    }
  });

  it("keeps the stalls a short walk from spawn", () => {
    const { session } = hub();
    const spawn = session.spawnPoints[0]!;

    for (const loot of session.dungeon.loot) {
      expect(Math.hypot(loot.position.x - spawn.x, loot.position.y - spawn.y)).toBeLessThan(10 * TILE_SCALE);
    }
  });

  it("shows every pickup, the gate and the whole hub from spawn", () => {
    const { session, viewer } = hub();
    const frame = visibilityFrameForPlayer(session, viewer);

    expect(frame.dungeon.loot).toHaveLength(6);
    expect(frame.dungeon.exits).toHaveLength(1);
    expect(frame.dungeon.lightSources.find((light) => light.tint === "red")).toBeDefined();

    // Not a pocket left dark behind the fountain or the grove's trees, nor the forest the awnings
    // and the gate's arch are drawn over.
    expect(viewer.discoveredTiles.every((tile) => tile === 1)).toBe(true);
  });

  it("sends the theme and every prop with the first map, and no props after", () => {
    const { session, viewer } = hub();
    visibilityFrameForPlayer(session, viewer);
    const first = takeMapDiscovery(session, viewer);

    expect(first.reset).toBe(true);
    expect(first.theme).toBe("forest");
    expect(first.props).toHaveLength(session.dungeon.map.props!.length);

    visibilityFrameForPlayer(session, viewer);
    const next = takeMapDiscovery(session, viewer);
    expect(next.reset).toBe(false);
    expect(next.props).toBeUndefined();
    expect(next.theme).toBe("forest");
  });

  it("sends a dungeon prop only once part of it has been discovered", () => {
    const { session, viewer } = hub();
    // Played as a dungeon, where light decides what is seen, with one prop deep in the forest's
    // corner, out of every light.
    session.location = "dungeon";
    session.dungeon.map.props = [{ kind: "bush", x: 0, y: 0 }];

    visibilityFrameForPlayer(session, viewer);
    expect(takeMapDiscovery(session, viewer).props).toBeUndefined();

    viewer.discoveredTiles[0] = 1;
    viewer.pendingDiscovery.push(0);
    expect(takeMapDiscovery(session, viewer).props).toEqual([{ kind: "bush", x: 0, y: 0 }]);

    viewer.discoveredTiles[1] = 1;
    viewer.pendingDiscovery.push(1);
    expect(takeMapDiscovery(session, viewer).props).toBeUndefined();
  });

  it("leaves generated dungeons in stone with no props", () => {
    const session = testSession([testPlayer("viewer")]);
    const viewer = session.players.get("viewer")!;
    visibilityFrameForPlayer(session, viewer);
    const discovery = takeMapDiscovery(session, viewer);

    expect(discovery.theme).toBeUndefined();
    expect(discovery.props).toBeUndefined();
  });
});
