import { describe, expect, it } from "vitest";
import { DEFAULT_APPEARANCE } from "../../src/shared/constants/appearance.js";
import { applyMapDiscovery } from "../../src/client/state/discoveredMap.js";
import {
  MINIMAP_MAX_SCALE,
  MINIMAP_MIN_SCALE,
  MINIMAP_SIZE,
  minimapAllies,
  minimapIcons,
  minimapInitial,
  minimapPoint,
  minimapRoomHeader,
  minimapRoomKindAt,
  MINIMAP_KIND_LABELS,
  MINIMAP_KIND_TINTS,
  minimapRoomName,
  minimapTile,
  minimapViewport,
  minimapWorldKey,
  NO_MARKERS,
  rememberMarkers,
  syncMinimapVisibility,
} from "../../src/client/state/minimap.js";
import { PARTY_PALETTES } from "../../src/client/rendering/characterPalettes.js";
import { initialSessionView, type SessionView } from "../../src/client/network/sessionState.js";
import { roomKindSchema } from "../../src/shared/types/core.js";
import type {
  ChestState,
  DungeonMapState,
  ExitState,
  MapDiscovery,
  PlayerState,
  RoomState,
} from "../../src/shared/types/core.js";

function discovery(overrides: Partial<MapDiscovery> = {}): MapDiscovery {
  return {
    id: "world",
    name: "World",
    width: 6,
    height: 3,
    reset: true,
    discovered: [{ x: 1, y: 1, tiles: "#.." }],
    ...overrides,
  } as MapDiscovery;
}

function player(id: string, overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id,
    name: id,
    position: { x: 2, y: 1 },
    facing: { x: 1, y: 0 },
    health: 10,
    resistance: 0,
    stamina: 10,
    ready: false,
    connected: true,
    inventory: [],
    held: null,
    drawFraction: null,
    carryingTorch: false,
    carryingPlayerId: null,
    carriedByPlayerId: null,
    seatId: null,
    readyPlateId: null,
    appearance: { ...DEFAULT_APPEARANCE },
    partyColor: "ember",
    ...overrides,
  } as PlayerState;
}

function viewWith(map: DungeonMapState, overrides: Partial<SessionView> = {}): SessionView {
  return {
    ...initialSessionView,
    phase: "inSession",
    selfId: "me",
    location: "dungeon",
    dungeon: { map } as SessionView["dungeon"],
    ...overrides,
  };
}

describe("minimap viewport", () => {
  it("shows a small world whole, centred, at the largest scale", () => {
    const viewport = minimapViewport(10, 10, { x: 0, y: 0 });
    expect(viewport.scale).toBe(MINIMAP_MAX_SCALE);
    expect(viewport.left).toBeLessThan(0);
    // The world's centre lands on the panel's centre.
    expect(minimapPoint(viewport, 5, 5)).toEqual({ x: MINIMAP_SIZE / 2, y: MINIMAP_SIZE / 2 });
  });

  it("fits a medium world to the panel", () => {
    const viewport = minimapViewport(84, 56, { x: 40, y: 20 });
    expect(viewport.scale).toBeCloseTo(MINIMAP_SIZE / 84);
    expect(viewport.left).toBe(0);
  });

  it("windows around the player on a large world, never past the edges", () => {
    const size = 400;
    const middle = minimapViewport(size, size, { x: 200, y: 200 });
    expect(middle.scale).toBe(MINIMAP_MIN_SCALE);
    expect(minimapPoint(middle, 200.5, 200.5)).toEqual({ x: MINIMAP_SIZE / 2, y: MINIMAP_SIZE / 2 });

    const corner = minimapViewport(size, size, { x: 0, y: 399 });
    expect(corner.left).toBe(0);
    expect(corner.top).toBe(size - corner.tilesAcross);
  });
});

describe("minimap tiles from the accumulated map", () => {
  it("is black except what has been discovered", () => {
    const map = applyMapDiscovery(null, discovery());
    expect(minimapTile(map, 0, 0)).toBe("unknown");
    expect(minimapTile(map, 1, 1)).toBe("wall");
    expect(minimapTile(map, 2, 1)).toBe("floor");
    expect(minimapTile(map, 99, 99)).toBe("unknown");
  });

  it("reveals tiles from a delta the local player never lit, and nothing else", () => {
    const first = applyMapDiscovery(null, discovery());
    const next = applyMapDiscovery(
      first,
      discovery({ reset: false, discovered: [{ x: 5, y: 2, tiles: "." }] }),
    );
    expect(minimapTile(next, 5, 2)).toBe("floor");
    expect(minimapTile(next, 4, 2)).toBe("unknown");
    expect(minimapTile(next, 2, 1)).toBe("floor");
  });
});

describe("minimap allies", () => {
  const map = applyMapDiscovery(null, discovery());

  it("lists only visible allies, never self or remembered ones", () => {
    const view = viewWith(map, {
      players: [player("me"), player("seen"), player("gone")],
      visiblePlayerIds: ["me", "seen"],
    });
    expect(minimapAllies(view).map((ally) => ally.id)).toEqual(["seen"]);
  });

  it("marks downed allies with a different shape", () => {
    const view = viewWith(map, {
      players: [player("me"), player("up"), player("down", { health: 0 })],
      visiblePlayerIds: ["me", "up", "down"],
    });
    const shapes = Object.fromEntries(minimapAllies(view).map((ally) => [ally.id, ally.shape]));
    expect(shapes).toEqual({ up: "standing", down: "downed" });
  });

  it("marks each ally in their party colour with their initial, standing or downed", () => {
    const view = viewWith(map, {
      players: [
        player("me", { partyColor: "ember" }),
        player("maya", { name: "maya", partyColor: "moss" }),
        player("noor", { name: "Noor", partyColor: "plum", health: 0 }),
      ],
      visiblePlayerIds: ["me", "maya", "noor"],
    });
    expect(minimapAllies(view).map(({ id, color, initial, shape }) => ({ id, color, initial, shape }))).toEqual([
      { id: "maya", color: PARTY_PALETTES.moss.ring, initial: "M", shape: "standing" },
      { id: "noor", color: PARTY_PALETTES.plum.ring, initial: "N", shape: "downed" },
    ]);
  });

  it("takes the first letter or digit of a name for the initial", () => {
    expect(minimapInitial("  _seth")).toBe("S");
    expect(minimapInitial("élan")).toBe("É");
    expect(minimapInitial("7th")).toBe("7");
    expect(minimapInitial("--")).toBe("?");
  });
});

describe("minimap icons", () => {
  // Discovered: (1,1) wall, (2,1) and (3,1) floor. Everything else is dark.
  const map = applyMapDiscovery(null, discovery());
  const exit = (id: string, x: number, y = 1): ExitState => ({
    id,
    position: { x, y },
    destination: "hub",
    sealed: false,
  });
  const chest = (id: string, x: number, y = 1, opened = false): ChestState => ({
    id,
    lootTableId: "chest",
    position: { x, y },
    opened,
    locked: false,
  });

  it("shows exits and chests only on discovered tiles", () => {
    const markers = rememberMarkers(NO_MARKERS, "a", {
      exits: [exit("seen-exit", 2), exit("dark-exit", 5, 2)],
      chests: [chest("seen-chest", 3), chest("dark-chest", 0, 0)],
    });
    expect(minimapIcons(map, markers)).toEqual([
      { id: "seen-exit", kind: "exit", tile: { x: 2, y: 1 } },
      { id: "seen-chest", kind: "chest", tile: { x: 3, y: 1 } },
    ]);
  });

  it("shows a chest that comes into discovered ground once the map grows", () => {
    const markers = rememberMarkers(NO_MARKERS, "a", { exits: [], chests: [chest("c", 5, 2)] });
    expect(minimapIcons(map, markers)).toEqual([]);
    const grown = applyMapDiscovery(map, discovery({ reset: false, discovered: [{ x: 5, y: 2, tiles: "." }] }));
    expect(minimapIcons(grown, markers).map((icon) => icon.id)).toEqual(["c"]);
  });

  it("marks an opened chest differently, and keeps the last state seen", () => {
    const closed = rememberMarkers(NO_MARKERS, "a", { exits: [], chests: [chest("c", 2)] });
    // Out of sight the chest is no longer sent, but stays remembered as it was.
    expect(rememberMarkers(closed, "a", { exits: [], chests: [] })).toBe(closed);
    const opened = rememberMarkers(closed, "a", { exits: [], chests: [chest("c", 2, 1, true)] });
    expect(minimapIcons(map, opened)).toEqual([{ id: "c", kind: "openedChest", tile: { x: 2, y: 1 } }]);
    expect(rememberMarkers(opened, "a", { exits: [], chests: [chest("c", 2, 1, true)] })).toBe(opened);
  });
});

describe("minimap world lifecycle", () => {
  const map = applyMapDiscovery(null, discovery());
  const exit = (id: string, x: number): ExitState => ({
    id,
    position: { x, y: 1 },
    destination: "hub",
    sealed: false,
  });

  it("keys a world by location and map, and has none outside a session", () => {
    expect(minimapWorldKey(initialSessionView)).toBeNull();
    const hub = minimapWorldKey(viewWith(map, { location: "hub" }));
    const run = minimapWorldKey(viewWith(map, { location: "dungeon" }));
    expect(hub).not.toBe(run);
    // A discovery delta makes a new map object but not a new world.
    const grown = applyMapDiscovery(map, discovery({ reset: false, discovered: [{ x: 0, y: 0, tiles: "#" }] }));
    expect(minimapWorldKey(viewWith(grown))).toBe(run);
  });

  it("keeps the toggle across a refresh and resets it for a new world", () => {
    const hidden = syncMinimapVisibility({ worldKey: "a", visible: false }, "a");
    expect(hidden.visible).toBe(false);
    expect(syncMinimapVisibility(hidden, "b")).toEqual({ worldKey: "b", visible: true });
    expect(syncMinimapVisibility(hidden, null)).toEqual({ worldKey: null, visible: true });
  });

  it("remembers exits and chests once seen, and forgets them with the world", () => {
    const chest: ChestState = { id: "c", lootTableId: "chest", position: { x: 2, y: 1 }, opened: false, locked: false };
    const seen = rememberMarkers(NO_MARKERS, "a", { exits: [exit("x", 3)], chests: [chest] });
    expect(seen.exits.get("x")).toEqual({ x: 3, y: 1 });
    expect(seen.chests.get("c")).toEqual({ position: { x: 2, y: 1 }, opened: false });

    const out = rememberMarkers(seen, "a", { exits: [], chests: [] });
    expect(out).toBe(seen);
    expect(rememberMarkers(out, "a", { exits: [exit("x", 3)], chests: [chest] })).toBe(seen);

    const next = rememberMarkers(seen, "b", { exits: [], chests: [] });
    expect(next.exits.size + next.chests.size).toBe(0);
    const none = rememberMarkers(seen, null, { exits: [exit("x", 3)], chests: [chest] });
    expect(none).toBe(NO_MARKERS);
  });
});

describe("minimap header", () => {
  const map = applyMapDiscovery(null, discovery({ name: "Ember Vault" }));
  const hall: RoomState = { id: "hall", name: "Ember Hall", kind: "hall", x: 0, y: 0, width: 3, height: 3 };
  const inDungeon = (overrides: Partial<SessionView> = {}): SessionView =>
    viewWith(map, {
      location: "dungeon",
      dungeon: { map, rooms: [hall] } as unknown as SessionView["dungeon"],
      ...overrides,
    });

  it("reads Hub in the hub, whatever area of it the player stands in", () => {
    expect(minimapRoomName(inDungeon({ location: "hub" }), { x: 1.5, y: 1.5 })).toBe("Hub");
  });

  it("names the room the player stands in, and follows them out of it", () => {
    const view = inDungeon();
    expect(minimapRoomName(view, { x: 1.5, y: 1.5 })).toBe("Ember Hall");
    // Between authored rooms the dungeon's own name stands in.
    expect(minimapRoomName(view, { x: 4.5, y: 1.5 })).toBe("Ember Vault");
  });

  it("has nothing to name outside a world", () => {
    expect(minimapRoomName(initialSessionView, null)).toBe("-");
  });
});

describe("minimap room kinds", () => {
  const map = applyMapDiscovery(null, discovery());
  const shrine: RoomState = { id: "s", name: "Quiet Alcove", kind: "shrine", x: 0, y: 0, width: 3, height: 3 };
  const view = viewWith(map, {
    location: "dungeon",
    dungeon: { map, rooms: [shrine] } as unknown as SessionView["dungeon"],
  });

  it("names every room kind and tints the new ones", () => {
    for (const kind of roomKindSchema.options) expect(MINIMAP_KIND_LABELS[kind]).toBeTruthy();
    for (const kind of ["camp", "shrine", "secret", "arena", "cavern"] as const) {
      expect(MINIMAP_KIND_TINTS[kind]).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("adds the kind to the header unless the name already says it", () => {
    expect(minimapRoomHeader(view, { x: 1.5, y: 1.5 })).toBe("Quiet Alcove · Shrine");
    const named = { ...view, dungeon: { ...view.dungeon!, rooms: [{ ...shrine, name: "The Shrine" }] } };
    expect(minimapRoomHeader(named, { x: 1.5, y: 1.5 })).toBe("The Shrine");
    expect(minimapRoomHeader(view, { x: 4.5, y: 1.5 })).toBe("World");
  });

  it("finds the kind only inside a room the client has been sent", () => {
    expect(minimapRoomKindAt([shrine], 1, 1)).toBe("shrine");
    expect(minimapRoomKindAt([shrine], 3, 1)).toBeNull();
    expect(minimapRoomKindAt([], 1, 1)).toBeNull();
  });
});
