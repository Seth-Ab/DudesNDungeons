import { describe, expect, it } from "vitest";
import { opacityFor } from "../../src/server/game/opacity.js";
import { visibleTilesForPlayer } from "../../src/server/game/visibility.js";
import { coversTile, tileAt } from "../../src/shared/game/movement.js";
import type { DoorState, DungeonState } from "../../src/shared/types/core.js";
import { testPlayer, testSession } from "./fixtures.js";

const MAP = [
  "####################",
  "#..................#",
  "#..................#",
  "#..................#",
  "#..................#",
  "#..................#",
  "####################",
];

function flatMap(tiles: string[]) {
  return {
    id: "test",
    name: "Test",
    width: tiles[0]?.length ?? 0,
    height: tiles.length,
    originX: 0,
    originY: 0,
    tiles,
  };
}

function door(id: string, x: number, y: number, size: number, open = false): DoorState {
  return { id, position: { x, y }, size, open, locked: false };
}

/** A dungeon with two four-tile doors, one across the room at x 5-8 and one at x 12-15. */
function dungeonWithDoors(): DungeonState {
  const session = testSession([testPlayer("viewer", { position: { x: 2, y: 3 } })]);
  session.dungeon.map = flatMap(MAP);
  session.dungeon.lightSources = [];
  session.dungeon.doors = [
    door("a", 6.5, 3.5, 4),
    door("b", 13.5, 3.5, 4),
  ];
  return session.dungeon;
}

/** The answer the grid replaces: read the map, then scan every door. */
function scanned(dungeon: DungeonState, x: number, y: number): boolean {
  const tile = tileAt(dungeon.map, x, y);
  if (tile === null || tile === "#") return true;
  return dungeon.doors.some((candidate) => !candidate.open && coversTile(candidate, x, y));
}

describe("the opacity grid", () => {
  it("agrees with scanning the map and every door, for every tile and just past the edges", () => {
    const dungeon = dungeonWithDoors();
    dungeon.doors[1]!.open = true;
    const grid = opacityFor(dungeon);

    for (let y = -2; y < dungeon.map.height + 2; y += 1) {
      for (let x = -2; x < dungeon.map.width + 2; x += 1) {
        expect(grid.isOpaque(x, y), `tile ${x},${y}`).toBe(scanned(dungeon, x, y));
      }
    }
  });

  it("fills a closed door's whole span, not just its centre tile", () => {
    const dungeon = dungeonWithDoors();
    const grid = opacityFor(dungeon);

    // Centred at 6.5, 3.5 and four across: tiles 5 to 8 along, 2 to 5 down.
    for (let y = 2; y <= 5; y += 1) {
      for (let x = 5; x <= 8; x += 1) expect(grid.isOpaque(x, y), `tile ${x},${y}`).toBe(true);
    }
    expect(grid.isOpaque(4, 3)).toBe(false);
    expect(grid.isOpaque(9, 3)).toBe(false);
    expect(grid.isOpaque(5, 1)).toBe(false);
  });

  it("clears a door the moment it is opened, even when the flag is set directly", () => {
    const dungeon = dungeonWithDoors();
    expect(opacityFor(dungeon).isOpaque(6, 3)).toBe(true);

    dungeon.doors[0]!.open = true;

    expect(opacityFor(dungeon).isOpaque(6, 3)).toBe(false);
    expect(opacityFor(dungeon).isOpaque(13, 3)).toBe(true);
  });

  it("closes again when a door does, and walls never change", () => {
    const dungeon = dungeonWithDoors();
    dungeon.doors[0]!.open = true;
    opacityFor(dungeon);
    dungeon.doors[0]!.open = false;

    const grid = opacityFor(dungeon);
    expect(grid.isOpaque(6, 3)).toBe(true);
    expect(grid.isOpaque(0, 0)).toBe(true);
    expect(grid.isOpaque(3, 3)).toBe(false);
  });

  it("changes its signature exactly when a door does", () => {
    const dungeon = dungeonWithDoors();
    const first = opacityFor(dungeon).signature;

    expect(opacityFor(dungeon).signature).toBe(first);
    dungeon.doors[1]!.open = true;
    const opened = opacityFor(dungeon).signature;

    expect(opened).not.toBe(first);
    expect(opacityFor(dungeon).signature).toBe(opened);
    expect(first).toBe("00");
    expect(opened).toBe("01");
  });

  it("reuses one grid while nothing changes", () => {
    const dungeon = dungeonWithDoors();

    expect(opacityFor(dungeon)).toBe(opacityFor(dungeon));
  });

  it("names the door that fills a tile, and none outside it or off the map", () => {
    const dungeon = dungeonWithDoors();
    const grid = opacityFor(dungeon);

    expect(grid.doorIndexAt(6, 3)).toBe(0);
    expect(grid.doorIndexAt(14, 2)).toBe(1);
    expect(grid.doorIndexAt(3, 3)).toBe(-1);
    // Off the map must not wrap around to a tile on the far side, which a flat index would do.
    expect(grid.doorIndexAt(-1, 3)).toBe(-1);
    expect(grid.doorIndexAt(MAP[0]!.length, 3)).toBe(-1);
    expect(grid.doorIndexAt(6, -1)).toBe(-1);
  });

  it("stops naming a door once it opens", () => {
    const dungeon = dungeonWithDoors();
    dungeon.doors[0]!.open = true;

    expect(opacityFor(dungeon).doorIndexAt(6, 3)).toBe(-1);
  });

  it("keeps dungeons that share a map apart", () => {
    const dungeon = dungeonWithDoors();
    const opened: DungeonState = {
      ...dungeon,
      doors: dungeon.doors.map((candidate) => ({ ...candidate, open: true })),
    };

    expect(opacityFor(dungeon).isOpaque(6, 3)).toBe(true);
    expect(opacityFor(opened).isOpaque(6, 3)).toBe(false);
    expect(opacityFor(dungeon).isOpaque(6, 3)).toBe(true);
  });

  it("notices when a dungeon is given a different set of doors", () => {
    const dungeon = dungeonWithDoors();
    opacityFor(dungeon);
    dungeon.doors = [door("only", 6.5, 3.5, 4)];

    const grid = opacityFor(dungeon);
    expect(grid.isOpaque(6, 3)).toBe(true);
    expect(grid.isOpaque(13, 3)).toBe(false);
  });
});

describe("a fixed light and a door", () => {
  it("lights past the door only while it is open, and stops again when it closes", () => {
    const viewer = testPlayer("viewer", { position: { x: 2, y: 3 } });
    const session = testSession([viewer]);
    session.dungeon.map = flatMap(MAP);
    session.dungeon.doors = [door("a", 6.5, 3.5, 4)];
    session.dungeon.lightSources = [
      { id: "lamp", name: "Lamp", kind: "fixed", position: { x: 2, y: 3 }, radius: 14 },
    ];

    const beyond = (): boolean => visibleTilesForPlayer(session, viewer).has("12,3");

    expect(beyond()).toBe(false);
    session.dungeon.doors[0]!.open = true;
    expect(beyond()).toBe(true);
    session.dungeon.doors[0]!.open = false;
    expect(beyond()).toBe(false);
  });
});
