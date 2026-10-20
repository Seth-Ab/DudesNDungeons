import { describe, expect, it } from "vitest";
import { DEFAULT_APPEARANCE } from "../../src/shared/constants/appearance.js";
import { applyMapDiscovery } from "../../src/client/state/discoveredMap.js";
import {
  MINIMAP_MAX_SCALE,
  MINIMAP_MIN_SCALE,
  MINIMAP_SIZE,
  minimapAllies,
  minimapPoint,
  minimapRoomName,
  minimapTile,
  minimapViewport,
  minimapWorldKey,
  NO_EXITS,
  rememberExits,
  syncMinimapVisibility,
} from "../../src/client/state/minimap.js";
import { initialSessionView, type SessionView } from "../../src/client/network/sessionState.js";
import type { DungeonMapState, ExitState, MapDiscovery, PlayerState, RoomState } from "../../src/shared/types/core.js";

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
    carryingTorch: false,
    carryingPlayerId: null,
    carriedByPlayerId: null,
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

  it("remembers exits once seen, and forgets them with the world", () => {
    const seen = rememberExits(NO_EXITS, "a", [exit("x", 3)]);
    expect(seen.exits.get("x")).toEqual({ x: 3, y: 1 });

    const out = rememberExits(seen, "a", []);
    expect(out).toBe(seen);
    expect(rememberExits(out, "a", [exit("x", 3)])).toBe(seen);

    expect(rememberExits(seen, "b", []).exits.size).toBe(0);
    expect(rememberExits(seen, null, [exit("x", 3)]).exits.size).toBe(0);
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
