import { describe, expect, it } from "vitest";
import { scaleDungeon, scalePoint } from "../../src/server/game/scale.js";
import { visibilityFrameForPlayer } from "../../src/server/game/visibility.js";
import { SNAPSHOT_VIEW_RADIUS_TILES, TILE_SCALE } from "../../src/shared/constants/game.js";
import { PLAYER_RADIUS, isOpen, tileAt } from "../../src/shared/game/movement.js";
import type { BuiltDungeon } from "../../src/server/game/dungeonBuilder.js";
import { testPlayer, testSession } from "./fixtures.js";

/** A one-tile-wide corridor between two rooms, authored the way a room template is. */
function authoredCorridor(): BuiltDungeon {
  return {
    dungeon: {
      map: {
        id: "corridor",
        name: "Corridor",
        width: 5,
        height: 3,
        originX: 0,
        originY: 0,
        tiles: ["#####", "#...#", "#####"],
      },
      rooms: [
        {
          id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          name: "Hall",
          kind: "hall",
          x: 1,
          y: 1,
          width: 3,
          height: 1,
        },
      ],
      monsters: [],
      loot: [],
      traps: [],
      doors: [
        {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          position: { x: 3, y: 1 },
          size: 1,
          open: false,
          locked: true,
        },
      ],
      exits: [],
      lightSources: [],
    },
    spawnPoints: [{ x: 1, y: 1 }],
    seed: null,
  };
}

describe("scaling a dungeon to world size", () => {
  it("turns every authored tile into a TILE_SCALE block", () => {
    const { dungeon } = scaleDungeon(authoredCorridor());

    expect(dungeon.map.width).toBe(5 * TILE_SCALE);
    expect(dungeon.map.height).toBe(3 * TILE_SCALE);
    expect(dungeon.map.tiles).toHaveLength(3 * TILE_SCALE);
    expect(dungeon.map.tiles[0]).toBe("#".repeat(5 * TILE_SCALE));
    // The corridor row: one authored wall, three authored floors, one authored wall.
    expect(dungeon.map.tiles[TILE_SCALE]).toBe(
      "#".repeat(TILE_SCALE) + ".".repeat(3 * TILE_SCALE) + "#".repeat(TILE_SCALE),
    );
  });

  it("puts an entity at the centre of the block its tile became", () => {
    const offset = (TILE_SCALE - 1) / 2;

    expect(scalePoint({ x: 0, y: 0 })).toEqual({ x: offset, y: offset });
    expect(scalePoint({ x: 3, y: 2 })).toEqual({
      x: 3 * TILE_SCALE + offset,
      y: 2 * TILE_SCALE + offset,
    });
  });

  it("grows a room's bounds at both corners, so it stays flush with its walls", () => {
    const room = scaleDungeon(authoredCorridor()).dungeon.rooms[0]!;

    expect(room).toMatchObject({
      x: 1 * TILE_SCALE,
      y: 1 * TILE_SCALE,
      width: 3 * TILE_SCALE,
      height: 1 * TILE_SCALE,
    });
  });

  it("leaves the whole world in one piece, with the window starting at its origin", () => {
    const { dungeon } = scaleDungeon(authoredCorridor());

    expect(dungeon.map.originX).toBe(0);
    expect(dungeon.map.originY).toBe(0);
  });
});

describe("a corridor at world scale", () => {
  const { dungeon } = scaleDungeon(authoredCorridor());

  it("fits a party of four abreast, which is the point of the scale", () => {
    // The corridor is one authored tile tall, so it spans world rows TILE_SCALE to 2 * TILE_SCALE
    // and its floor starts at TILE_SCALE - 0.5. Four bodies laid across it still fit, with room to
    // spare; before the scale change the same corridor was one world unit wide and held one.
    const shoulderToShoulder = PLAYER_RADIUS * 2 + 0.05;
    const party = Array.from({ length: 4 }, (_, index) => ({
      x: 2 * TILE_SCALE,
      y: TILE_SCALE - 0.5 + PLAYER_RADIUS + index * shoulderToShoulder,
    }));

    for (const [index, position] of party.entries()) {
      expect(isOpen(dungeon, party.slice(0, index), position)).toBe(true);
    }
  });

  it("is blocked across its whole width by a closed door", () => {
    // Every world row of the corridor, not merely the one the door's centre falls on.
    for (let y = TILE_SCALE; y < 2 * TILE_SCALE; y += 1) {
      expect(isOpen(dungeon, [], { x: 3 * TILE_SCALE + 1, y })).toBe(false);
    }

    const opened = { ...dungeon, doors: dungeon.doors.map((door) => ({ ...door, open: true })) };
    for (let y = TILE_SCALE; y < 2 * TILE_SCALE; y += 1) {
      expect(isOpen(opened, [], { x: 3 * TILE_SCALE + 1, y })).toBe(true);
    }
  });
});

/** A floor tile far enough from the world's origin that a window around it is clipped on all sides. */
function deepFloorTile(tiles: readonly string[]): { x: number; y: number } {
  for (let y = SNAPSHOT_VIEW_RADIUS_TILES + 1; y < tiles.length - SNAPSHOT_VIEW_RADIUS_TILES; y += 1) {
    const row = tiles[y]!;
    for (let x = SNAPSHOT_VIEW_RADIUS_TILES + 1; x < row.length - SNAPSHOT_VIEW_RADIUS_TILES; x += 1) {
      if (row[x] === ".") return { x, y };
    }
  }

  throw new Error("The generated world is too small to clip a snapshot window on every side");
}

describe("snapshots at world scale", () => {
  // The generated run, not the hand-authored vault: at world scale it is 384x256, which is what
  // makes the window worth having in the first place.
  it("carries a window around the viewer rather than the whole map", () => {
    const session = testSession([], "vault-run");
    const viewer = testPlayer("viewer", { position: { ...session.spawnPoints[0]! } });
    session.players.set(viewer.id, viewer);
    const { map } = visibilityFrameForPlayer(session, viewer).dungeon;

    // The full world is still reported, so a client knows the bounds it is moving inside.
    expect(map.width).toBe(session.dungeon.map.width);
    expect(map.height).toBe(session.dungeon.map.height);

    // The tiles are not: at this scale that would be far more than anyone can see or walk to.
    expect(map.tiles.length).toBeLessThanOrEqual(2 * SNAPSHOT_VIEW_RADIUS_TILES + 1);
    expect(map.tiles.length).toBeLessThan(session.dungeon.map.tiles.length);
  });

  it("anchors the window so a world coordinate reads back the tile it names", () => {
    const session = testSession([], "vault-run");
    // Deep enough into the world that the window is clipped on both axes, which is the case the
    // origin exists for: reading tile (x, y) out of it has to land on the same tile it names.
    const standingOn = deepFloorTile(session.dungeon.map.tiles);
    const viewer = testPlayer("viewer", { position: { ...standingOn } });
    session.players.set(viewer.id, viewer);

    const { map } = visibilityFrameForPlayer(session, viewer).dungeon;

    expect(map.originX).toBe(standingOn.x - SNAPSHOT_VIEW_RADIUS_TILES);
    expect(map.originY).toBe(standingOn.y - SNAPSHOT_VIEW_RADIUS_TILES);
    expect(tileAt(map, standingOn.x, standingOn.y)).toBe(".");
  });
});
