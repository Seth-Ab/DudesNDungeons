import { describe, expect, it } from "vitest";
import { scaleDungeon, scalePoint } from "../../src/server/game/scale.js";
import { applyMapDiscovery } from "../../src/client/state/discoveredMap.js";
import { takeMapDiscovery, visibilityFrameForPlayer } from "../../src/server/game/visibility.js";
import { TILE_SCALE } from "../../src/shared/constants/game.js";
import { PLAYER_RADIUS, isOpen, tileAt, tileOf } from "../../src/shared/game/movement.js";
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
      projectiles: [],
      loot: [],
      chests: [],
      altars: [],
      traps: [],
      puzzles: [],
      doors: [
        {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          position: { x: 3, y: 1 },
          size: 1,
          open: false,
          lock: { type: "key", keyItemId: "copper-key" },
        },
      ],
      exits: [],
      lightSources: [],
      dummies: [],
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

describe("snapshots at world scale", () => {
  // The generated run, not the hand-authored vault: at world scale it is 384x256, so sending the
  // whole map to a viewer who has seen a sliver of it would be the mistake worth catching.
  function viewerOnTheGeneratedRun() {
    const session = testSession([], "vault-run");
    const viewer = testPlayer("viewer", { position: { ...session.spawnPoints[0]! } });
    session.players.set(viewer.id, viewer);
    return { session, viewer };
  }

  it("reports the whole world's size but only the geometry the viewer has discovered", () => {
    const { session, viewer } = viewerOnTheGeneratedRun();
    visibilityFrameForPlayer(session, viewer);
    const map = takeMapDiscovery(session, viewer);

    // The bounds are always known, so a client knows what it is moving inside.
    expect(map.width).toBe(session.dungeon.map.width);
    expect(map.height).toBe(session.dungeon.map.height);

    const sent = map.discovered.reduce((total, run) => total + run.tiles.length, 0);
    expect(sent).toBeGreaterThan(0);
    expect(sent).toBeLessThan(0.1 * session.dungeon.map.width * session.dungeon.map.height);
  });

  it("lets the client read a world coordinate back as the tile it names", () => {
    const { session, viewer } = viewerOnTheGeneratedRun();
    visibilityFrameForPlayer(session, viewer);
    const map = applyMapDiscovery(null, takeMapDiscovery(session, viewer));
    const spawn = tileOf(viewer.position);

    expect(map.originX).toBe(0);
    expect(map.tiles).toHaveLength(session.dungeon.map.height);
    expect(tileAt(map, spawn.x, spawn.y)).toBe(".");
  });
});
