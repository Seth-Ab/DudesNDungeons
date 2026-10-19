import { describe, expect, it } from "vitest";

import {
  KNOWN_FLOOR,
  KNOWN_WALL,
  LIT_FLOOR,
  LIT_WALL,
  NEIGHBOUR_EAST,
  NEIGHBOUR_NORTH,
  NEIGHBOUR_SOUTH,
  NEIGHBOUR_WEST,
  SHEET_HEIGHT,
  SHEET_WIDTH,
  SPRITE_NAMES,
  SPRITE_TILE_SIZE,
  UNKNOWN,
  GROUND_VARIANTS,
  cobbleSprite,
  doorOrientation,
  floorSprite,
  grassFringes,
  groundSprite,
  itemSprite,
  overhangSprite,
  propSprite,
  spriteRect,
  tileLook,
  wallMask,
  wallSprite,
  type TileReader,
} from "../../src/client/rendering/tiles.js";
import {
  FACEABLE_PROP_KINDS,
  MAP_PROP_KINDS,
  MAP_PROP_SIZES,
  STALL_TINTS,
} from "../../src/shared/constants/scenery.js";

/** Reads a tile out of a small map drawn as text, the way a snapshot window is laid out. */
function readerFor(rows: string[]): TileReader {
  return (x, y) => rows[y]?.[x] ?? null;
}

describe("tile appearance", () => {
  it("reads the alphabet a snapshot carries", () => {
    expect(tileLook(LIT_WALL)).toEqual({ surface: "wall", dim: false });
    expect(tileLook(LIT_FLOOR)).toEqual({ surface: "floor", dim: false });
    expect(tileLook(KNOWN_WALL)).toEqual({ surface: "wall", dim: true });
    expect(tileLook(KNOWN_FLOOR)).toEqual({ surface: "floor", dim: true });
  });

  it("draws nothing at all for space nobody has seen", () => {
    expect(tileLook(UNKNOWN)).toBeNull();
  });

  it("treats a character it has never met as lit floor", () => {
    // The seam with anything that adds a tile kind, such as a hub flagstone. Drawing a wall would
    // tell the player they cannot walk somewhere the server will let them walk.
    expect(tileLook("~")).toEqual({ surface: "floor", dim: false });
  });
});

describe("wall autotiling", () => {
  // A 5x3 block of wall standing in floor, which is the shape an authored wall tile becomes.
  const map = [
    ".......",
    ".#####.",
    ".#####.",
    ".#####.",
    ".......",
  ];

  it("joins a wall to its neighbours on every side it continues", () => {
    // The middle of the block: surrounded, so no edge is drawn on any side.
    expect(wallMask(readerFor(map), 3, 2)).toBe(
      NEIGHBOUR_NORTH | NEIGHBOUR_EAST | NEIGHBOUR_SOUTH | NEIGHBOUR_WEST,
    );
  });

  it("leaves the side facing floor open so an edge is drawn there", () => {
    // Top of the block, floor above it: every side but north continues.
    expect(wallMask(readerFor(map), 3, 1) & NEIGHBOUR_NORTH).toBe(0);
    expect(wallMask(readerFor(map), 3, 1) & NEIGHBOUR_SOUTH).toBe(NEIGHBOUR_SOUTH);
  });

  it("opens two sides at a corner of the block", () => {
    expect(wallMask(readerFor(map), 1, 1)).toBe(NEIGHBOUR_EAST | NEIGHBOUR_SOUTH);
    expect(wallMask(readerFor(map), 5, 3)).toBe(NEIGHBOUR_NORTH | NEIGHBOUR_WEST);
  });

  it("runs a wall on into undiscovered space rather than edging it", () => {
    // A wall beside space the viewer has not seen must not grow a lit lip there: it would look
    // wrong, and it would draw the shape of what they have not explored onto their screen.
    const unseen = readerFor(["###", "# #", "###"].map((row) => row.replace(" ", UNKNOWN)));
    expect(wallMask(unseen, 1, 0) & NEIGHBOUR_SOUTH).toBe(NEIGHBOUR_SOUTH);
  });

  it("runs a wall on past the edge of the snapshot window", () => {
    // `tileAt` returns null outside the window that arrived, which is not the same as floor.
    expect(wallMask(readerFor(["##"]), 0, 0)).toBe(
      NEIGHBOUR_NORTH | NEIGHBOUR_EAST | NEIGHBOUR_SOUTH | NEIGHBOUR_WEST,
    );
  });

  it("joins remembered wall the same as lit wall", () => {
    const half = readerFor(["+#+"]);
    expect(wallMask(half, 1, 0) & (NEIGHBOUR_EAST | NEIGHBOUR_WEST)).toBe(
      NEIGHBOUR_EAST | NEIGHBOUR_WEST,
    );
  });

  it("names a cell for every mask the sheet provides", () => {
    for (let mask = 0; mask < 16; mask += 1) {
      expect(SPRITE_NAMES).toContain(wallSprite(mask));
    }
  });
});

describe("door orientation", () => {
  // `doorState` carries no orientation, so the renderer reads it off the map. A door is a block of
  // TILE_SCALE world tiles, so these use a span of 4 and centres on the half-tile the scaler puts
  // them on.
  const span = 4;

  it("lays the leaf flat along a wall that runs east-west", () => {
    // A gap punched through a horizontal wall. The door fills columns 4..7, centred at 5.5, and
    // has wall at columns 3 and 8.
    const map = [
      "............",
      "####....####",
      "............",
    ];
    expect(doorOrientation(readerFor(map), 5.5, 1, span)).toBe("h");
  });

  it("stands the leaf across a corridor with open floor either side", () => {
    // The Ember Vault's sealed door: wall above and below, floor east and west.
    const map = [
      "......#.........",
      "....#####.......",
      "................",
    ];
    expect(doorOrientation(readerFor(map), 5.5, 2, span)).toBe("v");
  });

  it("treats the edge of the snapshot window as wall", () => {
    // A door filling the whole window the snapshot carried, so both neighbours read as null. That
    // is not floor: the wall carries on, the viewer simply was not sent it.
    expect(doorOrientation(readerFor(["...."]), 1.5, 0, span)).toBe("h");
  });

  it("treats undiscovered space as wall", () => {
    // Columns 4..7 are the door; 3 and 8 are space this viewer has never seen.
    const map = [`${UNKNOWN.repeat(4)}....${UNKNOWN.repeat(4)}`];
    expect(doorOrientation(readerFor(map), 5.5, 0, span)).toBe("h");
  });
});

describe("floor variation", () => {

  it("only ever names a variant the sheet provides", () => {
    for (let y = -40; y < 40; y += 1) {
      for (let x = -40; x < 40; x += 1) {
        expect(SPRITE_NAMES).toContain(floorSprite(x, y));
      }
    }
  });

  it("does not repeat itself along a row or a column", () => {
    // A hash that ignored one axis would still pass the count above while drawing visible stripes.
    const row = new Set(Array.from({ length: 24 }, (_unused, x) => floorSprite(x, 7)));
    const column = new Set(Array.from({ length: 24 }, (_unused, y) => floorSprite(7, y)));
    expect(row.size).toBeGreaterThan(1);
    expect(column.size).toBeGreaterThan(1);
  });
});

describe("sheet layout", () => {
  it("keeps every sprite inside the sheet", () => {
    for (const name of SPRITE_NAMES) {
      const rect = spriteRect(name);
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(SHEET_WIDTH);
      expect(rect.y + rect.height).toBeLessThanOrEqual(SHEET_HEIGHT);
    }
  });

  it("never overlaps two sprites", () => {
    const rects = SPRITE_NAMES.map((name) => ({ name, ...spriteRect(name) }));

    for (const a of rects) {
      for (const b of rects) {
        if (a.name === b.name) continue;
        const apart =
          a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
        expect(apart, `${a.name} overlaps ${b.name}`).toBe(true);
      }
    }
  });

  it("packs every sprite on the tile grid", () => {
    // Off the grid, a sprite would be sampled across a cell boundary and pick up its neighbour.
    for (const name of SPRITE_NAMES) {
      const rect = spriteRect(name);
      expect(rect.x % SPRITE_TILE_SIZE).toBe(0);
      expect(rect.y % SPRITE_TILE_SIZE).toBe(0);
    }
  });

  it("refuses a sprite it does not have", () => {
    expect(() => spriteRect("wall-99")).toThrow(/Unknown sprite/);
  });
});

describe("weapon art", () => {
  const weapon = (itemId: string) =>
    ({
      id: "c1111111-1111-4111-8111-111111111111",
      name: "Blade",
      kind: "weapon",
      itemId,
      weaponKind: "melee",
    }) as const;

  it("draws a weapon with its own sprite, or the generic one when it has none", () => {
    expect(itemSprite(weapon("rusted-sword"))).toBe("loot-rusted-sword");
    expect(itemSprite(weapon("unpainted-axe"))).toBe("loot-weapon");
    expect(SPRITE_NAMES).toContain("loot-rusted-sword");
  });

  it("draws ammo with the arrow sprite", () => {
    expect(
      itemSprite({ id: "c1111111-1111-4111-8111-111111111111", name: "Arrows", kind: "ammo", itemId: "arrow", count: 3 }),
    ).toBe("loot-arrow");
    expect(SPRITE_NAMES).toContain("loot-arrow");
  });
});

describe("map themes and props", () => {
  it("names a forest wall for every mask, and gives the forest the stone floor", () => {
    for (let mask = 0; mask < 16; mask += 1) {
      expect(wallSprite(mask)).toBe(`wall-${mask}`);
      expect(wallSprite(mask, "forest")).toBe(`forest-${mask}`);
      expect(SPRITE_NAMES).toContain(wallSprite(mask, "forest"));
    }
    for (let y = 0; y < 20; y += 1) {
      for (let x = 0; x < 20; x += 1) {
        expect(floorSprite(x, y, "forest")).toBe(floorSprite(x, y));
      }
    }
    // A shared floor is packed once.
    expect(SPRITE_NAMES.filter((name) => name === "floor-0")).toHaveLength(1);
  });

  it("reserves a cell for every prop kind at the size the server validates it against", () => {
    for (const kind of MAP_PROP_KINDS) {
      const rect = spriteRect(propSprite(kind));
      expect(rect.width).toBe(MAP_PROP_SIZES[kind].tilesWide * SPRITE_TILE_SIZE);
      expect(rect.height).toBe(MAP_PROP_SIZES[kind].tilesHigh * SPRITE_TILE_SIZE);
    }
  });
});

describe("the ground layer", () => {
  /** A ground reader over text rows: `#` is wall (no ground) and a space is unseen. */
  function groundFor(rows: string[]): (x: number, y: number) => string | null {
    return (x, y) => {
      const character = rows[y]?.[x];
      return character === undefined || character === "#" || character === " " ? null : character;
    };
  }

  it("draws `.` as the theme's own floor and each ground kind from its own variants", () => {
    for (let y = 0; y < 30; y += 1) {
      for (let x = 0; x < 30; x += 1) {
        expect(groundSprite(".", x, y)).toBe(floorSprite(x, y));
        expect(groundSprite(null, x, y, "forest")).toBe(floorSprite(x, y, "forest"));
        expect(groundSprite("c", x, y)).toMatch(/^cobble-[0-3]$/);
        expect(groundSprite("g", x, y)).toMatch(/^grass-[0-2]$/);
        expect(groundSprite("d", x, y)).toMatch(/^dirt-[01]$/);
      }
    }
  });

  it("uses every variant it declares, and the sheet has a cell for each", () => {
    const seen = new Set<string>();
    for (let y = 0; y < 40; y += 1) {
      for (let x = 0; x < 40; x += 1) for (const ground of ["c", "g", "d"]) seen.add(groundSprite(ground, x, y));
    }
    for (const [kind, count] of Object.entries(GROUND_VARIANTS)) {
      for (let variant = 0; variant < count; variant += 1) {
        expect(seen).toContain(`${kind}-${variant}`);
        expect(SPRITE_NAMES).toContain(`${kind}-${variant}`);
      }
    }
  });

  it("never puts the same cobble on two tiles that share an edge", () => {
    for (let y = -50; y < 50; y += 1) {
      for (let x = -50; x < 50; x += 1) {
        expect(cobbleSprite(x, y)).not.toBe(cobbleSprite(x + 1, y));
        expect(cobbleSprite(x, y)).not.toBe(cobbleSprite(x, y + 1));
      }
    }
  });

  it("fringes cobble or dirt on each side that touches grass, and never grass itself", () => {
    const rows = [
      "ggg",
      "gcd",
      "cdg",
    ];
    const read = groundFor(rows);

    // The cobble in the middle has grass north and west, and at its south-east corner; the dirt
    // beside it has grass north and south.
    expect(grassFringes(read, 1, 1)).toEqual([`grass-edge-${NEIGHBOUR_NORTH | NEIGHBOUR_WEST}`, "grass-corner-se"]);
    expect(grassFringes(read, 2, 1)).toEqual([`grass-edge-${NEIGHBOUR_NORTH | NEIGHBOUR_SOUTH}`]);
    expect(grassFringes(read, 0, 0)).toEqual([]);
    expect(grassFringes(read, 2, 2)).toEqual([]);
  });

  it("adds a corner piece only where grass touches at a diagonal and at neither side beside it", () => {
    const read = groundFor([
      "gcg",
      "ccc",
      "gcc",
    ]);

    expect(grassFringes(read, 1, 1)).toEqual(["grass-corner-ne", "grass-corner-sw", "grass-corner-nw"]);
    // Grass straight above already fringes the top edge, so its diagonal neighbours add no corner.
    expect(grassFringes(groundFor(["ggg", "ccc"]), 1, 1)).toEqual([`grass-edge-${NEIGHBOUR_NORTH}`]);
  });

  it("ignores walls and unseen space when looking for grass", () => {
    expect(grassFringes(groundFor(["#g ", "c#c"]), 0, 1)).toEqual(["grass-corner-ne"]);
    expect(grassFringes(groundFor(["# #", " c ", "# #"]), 1, 1)).toEqual([]);
  });

  it("names a cell for every fringe and overhang it can ask for", () => {
    for (let mask = 1; mask < 16; mask += 1) {
      expect(SPRITE_NAMES).toContain(`grass-edge-${mask}`);
      expect(SPRITE_NAMES).toContain(`forest-overhang-${mask}`);
    }
    for (const corner of ["ne", "se", "sw", "nw"]) expect(SPRITE_NAMES).toContain(`grass-corner-${corner}`);
  });
});

describe("the forest canopy", () => {
  it("overhangs a floor tile from each side where known forest stands", () => {
    const read = readerFor([
      "#+#",
      "#..",
      " . ",
    ]);

    expect(overhangSprite(read, 1, 1, "forest")).toBe(`forest-overhang-${NEIGHBOUR_NORTH | NEIGHBOUR_WEST}`);
    // Remembered forest counts; unseen space does not.
    expect(overhangSprite(read, 1, 2, "forest")).toBeNull();
    expect(overhangSprite(readerFor(["+", ".", " "]), 0, 1, "forest")).toBe(`forest-overhang-${NEIGHBOUR_NORTH}`);
  });

  it("draws no overhang for a theme without one", () => {
    expect(overhangSprite(readerFor(["###", "#.#", "###"]), 1, 1, "stone")).toBeNull();
    expect(overhangSprite(readerFor(["###", "#.#", "###"]), 1, 1)).toBeNull();
  });
});

describe("stall awnings", () => {
  it("gives each tint its own stall, defaulting to ember, and leaves other props alone", () => {
    expect(propSprite("stall")).toBe("prop-stall-ember");
    for (const tint of STALL_TINTS) {
      expect(propSprite("stall", tint)).toBe(`prop-stall-${tint}`);
      expect(spriteRect(propSprite("stall", tint)).width).toBe(MAP_PROP_SIZES.stall.tilesWide * SPRITE_TILE_SIZE);
    }
    expect(propSprite("fountain", "moss")).toBe("prop-fountain");
  });
});

describe("prop facings", () => {
  it("draws a stall or bench facing north from behind, at the same size, and ignores facing elsewhere", () => {
    for (const tint of STALL_TINTS) {
      expect(propSprite("stall", tint, "north")).toBe(`prop-stall-${tint}-north`);
      expect(propSprite("stall", tint, "south")).toBe(`prop-stall-${tint}`);
    }
    expect(propSprite("stall", undefined, "north")).toBe("prop-stall-ember-north");
    expect(propSprite("bench", undefined, "north")).toBe("prop-bench-north");
    expect(propSprite("bench")).toBe("prop-bench");
    // Content refuses a facing on other kinds; a stray one still draws the kind's own sprite.
    expect(propSprite("tree", undefined, "north")).toBe("prop-tree");

    for (const kind of FACEABLE_PROP_KINDS) {
      const rect = spriteRect(propSprite(kind, undefined, "north"));
      expect(rect.width).toBe(MAP_PROP_SIZES[kind].tilesWide * SPRITE_TILE_SIZE);
      expect(rect.height).toBe(MAP_PROP_SIZES[kind].tilesHigh * SPRITE_TILE_SIZE);
    }
  });
});
