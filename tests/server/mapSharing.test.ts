import { describe, expect, it } from "vitest";
import { shareDiscoveredMaps } from "../../src/server/game/mapSharing.js";
import { returnToHub } from "../../src/server/game/runLifecycle.js";
import { takeMapDiscovery, visibilityFrameForPlayer } from "../../src/server/game/visibility.js";
import type { Session, SessionPlayer } from "../../src/server/sessions/sessionStore.js";
import { PLAYER_MAP_SHARE_RANGE } from "../../src/shared/constants/game.js";
import type { RoomState } from "../../src/shared/types/core.js";
import { testPlayer, testSession } from "./fixtures.js";

const WIDTH = 70;
/** A wall across the middle of the hall, so the far ends never see each other. */
const ROW = `#${".".repeat(33)}#${".".repeat(WIDTH - 36)}#`;

/** A long hall split by a wall, with three rooms along it, so players can be far apart and out of each other's sight. */
function hallSession(players: SessionPlayer[]): Session {
  const session = testSession(players);
  const wall = "#".repeat(WIDTH);
  session.dungeon.map = {
    id: "hall",
    name: "Hall",
    width: WIDTH,
    height: 5,
    originX: 0,
    originY: 0,
    tiles: [wall, ROW, ROW, ROW, wall],
  };
  session.dungeon.doors = [];
  session.dungeon.lightSources = [];
  session.dungeon.monsters = [];
  session.dungeon.loot = [];
  session.dungeon.rooms = [
    { id: "west", name: "West", x: 1, y: 1, width: 18, height: 3 },
    { id: "middle", name: "Middle", x: 25, y: 1, width: 18, height: 3 },
    { id: "east", name: "East", x: 50, y: 1, width: 18, height: 3 },
  ] as RoomState[];
  return session;
}

function walker(id: string, x: number): SessionPlayer {
  return testPlayer(id, { position: { x, y: 2 } });
}

function look(session: Session, ...viewers: SessionPlayer[]): void {
  for (const viewer of viewers) visibilityFrameForPlayer(session, viewer);
}

function known(player: SessionPlayer): Set<number> {
  const tiles = new Set<number>();
  player.discoveredTiles.forEach((value, index) => {
    if (value === 1) tiles.add(index);
  });
  return tiles;
}

const union = (...sets: Set<number>[]) => new Set(sets.flatMap((set) => [...set]));

describe("sharing discovered maps between nearby players", () => {
  it("gives each of two players the union of what both explored, once in range", () => {
    const west = walker("west", 5);
    const east = walker("east", 60);
    const session = hallSession([west, east]);
    look(session, west, east);

    const westBefore = known(west);
    const eastBefore = known(east);
    expect(westBefore.size).toBeGreaterThan(0);
    expect([...westBefore].some((tile) => eastBefore.has(tile))).toBe(false);
    expect(west.discoveredRoomIds).toEqual(new Set(["west"]));

    east.position = { x: 5 + PLAYER_MAP_SHARE_RANGE - 1, y: 2 };
    shareDiscoveredMaps(session);

    const both = union(westBefore, eastBefore);
    expect(known(west)).toEqual(both);
    expect(known(east)).toEqual(both);
    expect(west.discoveredRoomIds).toEqual(new Set(["west", "east"]));
    expect(east.discoveredRoomIds).toEqual(new Set(["west", "east"]));
  });

  it("exchanges nothing beyond the range, and keeps what it got after moving away", () => {
    const west = walker("west", 5);
    const east = walker("east", 60);
    const session = hallSession([west, east]);
    look(session, west, east);
    const westBefore = known(west);
    const eastBefore = known(east);

    east.position = { x: 5 + PLAYER_MAP_SHARE_RANGE + 0.5, y: 2 };
    shareDiscoveredMaps(session);
    expect(known(west)).toEqual(westBefore);
    expect(known(east)).toEqual(eastBefore);

    east.position = { x: 8, y: 2 };
    shareDiscoveredMaps(session);
    east.position = { x: 60, y: 2 };
    shareDiscoveredMaps(session);
    expect(known(east)).toEqual(union(westBefore, eastBefore));
  });

  it("does not exchange with a downed, disconnected, or hub-bound player", () => {
    const west = walker("west", 5);
    const east = walker("east", 60);
    const session = hallSession([west, east]);
    look(session, west, east);
    const westBefore = known(west);
    const eastBefore = known(east);
    east.position = { x: 8, y: 2 };

    east.health = 0;
    shareDiscoveredMaps(session);
    east.health = 100;
    east.connected = false;
    shareDiscoveredMaps(session);
    east.connected = true;
    session.location = "hub";
    shareDiscoveredMaps(session);

    expect(known(west)).toEqual(westBefore);
    expect(known(east)).toEqual(eastBefore);
  });

  it("does not mix players of different sessions", () => {
    const west = walker("west", 5);
    const stranger = walker("stranger", 8);
    const session = hallSession([west]);
    const other = hallSession([stranger]);
    stranger.position = { x: 60, y: 2 };
    look(session, west);
    look(other, stranger);
    const westBefore = known(west);
    stranger.position = { x: 8, y: 2 };

    shareDiscoveredMaps(session);
    shareDiscoveredMaps(other);

    expect(known(west)).toEqual(westBefore);
  });

  it("never changes what the receiver sees of monsters, loot, players, or light", () => {
    const west = walker("west", 5);
    const east = walker("east", 60);
    const session = hallSession([west, east]);
    const template = testSession([]).dungeon.monsters[0]!;
    session.dungeon.monsters = [{ ...template, position: { x: 62, y: 2 }, alive: true }];
    look(session, west, east);

    const near = { x: 5 + PLAYER_MAP_SHARE_RANGE - 1, y: 2 };
    east.position = near;
    const before = visibilityFrameForPlayer(session, west);
    const withoutEntities = ({ rooms: _rooms, doors: _doors, ...entities }: typeof before.dungeon) =>
      entities;

    shareDiscoveredMaps(session);
    const after = visibilityFrameForPlayer(session, west);

    expect(withoutEntities(after.dungeon)).toEqual(withoutEntities(before.dungeon));
    expect(after.players).toEqual(before.players);
    expect([...after.visiblePlayerIds]).toEqual([...before.visiblePlayerIds]);
  });

  it("leaves a monster in the sender's room unseen by the receiver", () => {
    const west = walker("west", 5);
    const east = walker("east", 60);
    const session = hallSession([west, east]);
    const template = testSession([]).dungeon.monsters[0]!;
    session.dungeon.monsters = [{ ...template, position: { x: 62, y: 2 }, alive: true }];
    look(session, west, east);
    expect(visibilityFrameForPlayer(session, east).dungeon.monsters).toHaveLength(1);

    east.position = { x: 8, y: 2 };
    shareDiscoveredMaps(session);
    east.position = { x: 8, y: 2 };

    const frame = visibilityFrameForPlayer(session, west);
    expect(frame.dungeon.monsters).toEqual([]);
    // The tile where it stands is now known geometry, but nothing about it is sent.
    expect(west.discoveredTiles[2 * WIDTH + 62]).toBe(1);
  });

  it("carries merged tiles and rooms to the client in the ordinary discovery delta", () => {
    const west = walker("west", 5);
    const east = walker("east", 60);
    const session = hallSession([west, east]);
    look(session, west, east);
    takeMapDiscovery(session, west);
    const eastOwn = known(east).size;

    east.position = { x: 8, y: 2 };
    shareDiscoveredMaps(session);
    const frame = visibilityFrameForPlayer(session, west);
    const delta = takeMapDiscovery(session, west);

    expect(delta.reset).toBe(false);
    const sent = delta.discovered.reduce((total, run) => total + run.tiles.length, 0);
    expect(sent).toBeGreaterThan(eastOwn / 2);
    expect(frame.dungeon.rooms.map((room) => room.id)).toContain("east");
  });

  it("lights none of the merged geometry: only the viewer's own light counts", () => {
    const west = walker("west", 5);
    const east = walker("east", 60);
    const session = hallSession([west, east]);
    look(session, west, east);
    takeMapDiscovery(session, west);

    east.position = { x: 8, y: 2 };
    shareDiscoveredMaps(session);
    visibilityFrameForPlayer(session, west);
    const { lit } = takeMapDiscovery(session, west);

    // West now knows the far side of the dividing wall at x = 34, but none of it is lit for them.
    expect(west.discoveredTiles[2 * WIDTH + 60]).toBe(1);
    expect(lit.length).toBeGreaterThan(0);
    expect(lit.every(([x, , length]) => x + length - 1 < 34)).toBe(true);
  });

  it("relays through a middle player and reaches the far one only by meeting", () => {
    const a = walker("a", 5);
    const b = walker("b", 10);
    const c = walker("c", 60);
    const session = hallSession([a, b, c]);
    look(session, a, b, c);
    const aOwn = known(a);
    const cOwn = known(c);

    shareDiscoveredMaps(session);
    c.position = { x: 15, y: 2 };
    look(session, a, b, c);
    shareDiscoveredMaps(session);
    shareDiscoveredMaps(session);

    // C is near B but not A, and still gets A's map through B.
    expect(Math.abs(c.position.x - a.position.x)).toBeGreaterThan(PLAYER_MAP_SHARE_RANGE);
    expect([...aOwn].every((tile) => known(c).has(tile))).toBe(true);
    expect([...cOwn].every((tile) => known(b).has(tile))).toBe(true);
    expect([...cOwn].every((tile) => known(a).has(tile))).toBe(true);
  });

  it("keeps a player's own discovery across a reconnect and catches them up after", () => {
    const west = walker("west", 5);
    const east = walker("east", 60);
    const session = hallSession([west, east]);
    look(session, west, east);
    const eastOwn = known(east);

    east.connected = false;
    east.position = { x: 8, y: 2 };
    shareDiscoveredMaps(session);
    expect(known(east)).toEqual(eastOwn);

    east.connected = true;
    east.mapSyncedTo = null;
    east.pendingDiscovery = [];
    shareDiscoveredMaps(session);
    expect(known(east)).toEqual(union(eastOwn, known(west)));
  });

  it("starts over on a new world", () => {
    const west = walker("west", 5);
    const east = walker("east", 8);
    const session = hallSession([west, east]);
    look(session, west, east);
    shareDiscoveredMaps(session);
    expect(known(west).size).toBeGreaterThan(0);

    returnToHub(session, true);

    for (const player of [west, east]) {
      expect(known(player).size).toBe(0);
      expect(player.discoveredRoomIds.size).toBe(0);
      expect(player.discoveryLog).toEqual([]);
    }
    session.location = "dungeon";
    shareDiscoveredMaps(session);
    expect(known(west).size).toBe(0);
  });
});
