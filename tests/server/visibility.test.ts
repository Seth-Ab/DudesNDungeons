import { describe, expect, it } from "vitest";
import { DEFAULT_APPEARANCE } from "../../src/shared/constants/appearance.js";
import { applyMapDiscovery } from "../../src/client/state/discoveredMap.js";
import {
  hasLineOfSight,
  takeMapDiscovery,
  visibilityFrameForPlayer,
  visibleTilesForPlayer,
  voiceRangeForPlayer,
} from "../../src/server/game/visibility.js";
import { returnToHub, startRun } from "../../src/server/game/runLifecycle.js";
import { SessionStore, rosterOf } from "../../src/server/sessions/sessionStore.js";
import { PLAYER_TORCH_LIGHT_RADIUS } from "../../src/shared/constants/game.js";
import { coversTile, distance, isFloor, tileAt, tileOf } from "../../src/shared/game/movement.js";
import type { DungeonMapState, RoomState, Vector2 } from "../../src/shared/types/core.js";
import { at, joinRequest, testPlayer, testSession } from "./fixtures.js";

/**
 * A one-room world to test a single rule against, written in world tiles rather than authored ones.
 *
 * Handing a session its own map is the point: the Ember Vault is a whole dungeon, and a test about
 * what one light reveals wants a corridor it can read in the assertion.
 */
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

/** What a client holds after the snapshot that follows `visibilityFrameForPlayer`, given what it held. */
function clientMap(
  session: Parameters<typeof takeMapDiscovery>[0],
  viewer: Parameters<typeof takeMapDiscovery>[1],
  previous: DungeonMapState | null = null,
): DungeonMapState {
  return applyMapDiscovery(previous, takeMapDiscovery(session, viewer));
}

describe("visibility frames", () => {
  it("sends a player only the party members and entities visible from their light radius", () => {
    const viewer = testPlayer("viewer", { position: at(2, 2) });
    const nearby = testPlayer("nearby", { position: at(2, 2, 1) });
    const distant = testPlayer("distant", { position: at(14, 6) });
    const session = testSession([viewer, nearby, distant]);

    const frame = visibilityFrameForPlayer(session, viewer);

    expect(frame.players.map((player) => player.id)).toEqual(["viewer", "nearby"]);
    expect(frame.dungeon.monsters).toEqual([]);
    expect(frame.dungeon.exits).toEqual([]);
    expect(JSON.stringify(frame)).not.toContain("distant");
  });

  it("carries a bank on the viewer's own entry and on no teammate's", () => {
    const tonic = { id: "55555555-5555-4555-8555-555555555555", name: "Key", kind: "key" as const, itemId: "copper-key" };
    const viewer = testPlayer("viewer", { position: at(2, 2) });
    const nearby = testPlayer("nearby", { position: at(2, 2, 1) });
    viewer.profile.bankedItems.push({ ...tonic });
    nearby.profile.bankedItems.push({ ...tonic, id: "66666666-6666-4666-8666-666666666666" });
    const session = testSession([viewer, nearby]);

    const asViewer = visibilityFrameForPlayer(session, viewer).players;
    const asNearby = visibilityFrameForPlayer(session, nearby).players;

    expect(asViewer.find((p) => p.id === "viewer")?.bankedItems).toEqual([tonic]);
    expect(asViewer.find((p) => p.id === "nearby")).not.toHaveProperty("bankedItems");
    expect(asNearby.find((p) => p.id === "viewer")).not.toHaveProperty("bankedItems");
    expect(asNearby.find((p) => p.id === "nearby")?.bankedItems).toHaveLength(1);
    expect(JSON.stringify(asViewer)).not.toContain("66666666");
  });

  it("filters a roster built once without mutating it for other viewers", () => {
    const viewer = testPlayer("viewer", { position: at(2, 2) });
    const nearby = testPlayer("nearby", { position: at(2, 2, 1) });
    const session = testSession([viewer, nearby]);
    const roster = rosterOf(session);

    visibilityFrameForPlayer(session, viewer, roster);

    expect(roster.every((entry) => !("bankedItems" in entry))).toBe(true);
  });

  it("keeps discovered geometry after the player moves away, without leaking entities there", () => {
    const viewer = testPlayer("viewer", { position: at(2, 2) });
    const session = testSession([viewer]);
    // A world tile inside the authored tile next to the spawn, lit from where the viewer starts.
    const nearSpawn = tileOf(at(1, 2));

    visibilityFrameForPlayer(session, viewer);
    const firstMap = clientMap(session, viewer);
    expect(tileAt(firstMap, nearSpawn.x, nearSpawn.y)).toBe(".");

    viewer.position = at(12, 6);
    const secondFrame = visibilityFrameForPlayer(session, viewer);
    const secondMap = clientMap(session, viewer, firstMap);

    // Out of the light now, but still part of the map the client holds.
    expect(visibleTilesForPlayer(session, viewer).hasAt(nearSpawn.x, nearSpawn.y)).toBe(false);
    expect(tileAt(secondMap, nearSpawn.x, nearSpawn.y)).toBe(".");
    expect(secondFrame.dungeon.loot.some((loot) => loot.name === "Minor Tonic")).toBe(false);
  });

  it("uses fixed lights to reveal geometry beyond a player's carried torch", () => {
    const viewer = testPlayer("viewer", {
      position: { x: 1, y: 1 },
      carryingTorch: false,
    });
    const session = testSession([viewer]);
    session.dungeon.map = flatMap(["########", "#......#", "########"]);
    session.dungeon.doors = [];
    session.dungeon.lightSources = [
      {
        id: "77777777-7777-4777-8777-777777777777",
        name: "Torch Pillar",
        kind: "fixed",
        position: { x: 5, y: 1 },
        radius: 2,
      },
    ];

    const frame = visibilityFrameForPlayer(session, viewer);

    expect(tileAt(clientMap(session, viewer), 6, 1)).toBe(".");
    expect(frame.dungeon.lightSources.map((light) => light.name)).toEqual(["Torch Pillar"]);
  });
});

describe("line of sight", () => {
  it("does not mark tiles visible through walls", () => {
    const viewer = testPlayer("viewer", { position: { x: 1, y: 1 } });
    const session = testSession([viewer]);
    session.dungeon.map = flatMap(["#####", "#.#.#", "#####"]);
    session.dungeon.doors = [];
    const visible = visibleTilesForPlayer(session, viewer);

    expect(visible.has("3,1")).toBe(false);
  });

  it("lights the walls of a corridor all the way along, not only beside the viewer", () => {
    // A ray aimed at a wall far down a corridor grazes the wall row and enters it a tile early, so
    // judged by line of sight alone, a corridor drew as a strip of floor with no walls at all.
    const viewer = testPlayer("viewer", { position: { x: 1, y: 3 } });
    const session = testSession([viewer]);
    session.dungeon.map = flatMap([
      "##############",
      "##############",
      "#............#",
      "#............#",
      "#............#",
      "#............#",
      "##############",
      "##############",
    ]);
    session.dungeon.doors = [];
    session.dungeon.lightSources = [];
    const visible = visibleTilesForPlayer(session, viewer);

    // From x = 1, the torch reaches floor out to x = 8; the walls beside that floor are lit with it.
    for (let x = 0; x <= Math.floor(PLAYER_TORCH_LIGHT_RADIUS); x += 1) {
      expect(visible.has(`${x},1`), `north wall at ${x}`).toBe(true);
      expect(visible.has(`${x},6`), `south wall at ${x}`).toBe(true);
    }
    // Only the face: the wall's far side is not lit through the wall.
    expect(visible.has("8,0")).toBe(false);
    expect(visible.has("8,7")).toBe(false);
  });

  /**
   * A closed door standing in a corridor, four world tiles across, exactly as `TILE_SCALE` makes
   * one authored doorway. The viewer stands two tiles west of its near edge.
   */
  function corridorWithClosedDoor() {
    const viewer = testPlayer("viewer", { position: { x: 2, y: 3 } });
    const session = testSession([viewer]);
    // A corridor four world tiles tall, which is what one authored tile becomes at `TILE_SCALE`.
    session.dungeon.map = flatMap([
      "##########",
      "##########",
      "#........#",
      "#........#",
      "#........#",
      "#........#",
      "##########",
    ]);
    session.dungeon.lightSources = [];
    // Centred so it fills world tiles 4-7 across and 2-5 down, the way `scaleDungeon` places one.
    session.dungeon.doors = [
      {
        id: "55555555-5555-4555-8555-555555555555",
        position: { x: 5.5, y: 3.5 },
        size: 4,
        open: false,
        lock: { type: "key", keyItemId: "copper-key" },
      },
    ];

    return { viewer, session };
  }

  it("shows a closed door to a player standing at it", () => {
    // A door is one object across sixteen tiles. Exempting only the single tile the ray was aimed
    // at left the other fifteen standing between the viewer and the door's own centre, so the
    // centre tile was never discovered and `stateSnapshot` carried no doors at all.
    const { viewer, session } = corridorWithClosedDoor();

    const frame = visibilityFrameForPlayer(session, viewer);

    expect(frame.dungeon.doors.map((door) => door.id)).toEqual([
      "55555555-5555-4555-8555-555555555555",
    ]);
  });

  it("still does not show what is behind a closed door", () => {
    // The other half of the rule: the door is visible, the room beyond it is not.
    const { viewer, session } = corridorWithClosedDoor();

    const visible = visibleTilesForPlayer(session, viewer);

    expect(visible.has("4,3")).toBe(true);
    expect(visible.has("8,3")).toBe(false);
  });
});

describe("a generated run", () => {
  /** The floor tile nearest a room's middle, so a maze's centre wall does not hold the player. */
  function middleOf(session: ReturnType<typeof testSession>, room: RoomState): Vector2 {
    const centre = { x: room.x + room.width / 2, y: room.y + room.height / 2 };
    let best: Vector2 | null = null;
    for (let y = room.y; y < room.y + room.height; y += 1) {
      for (let x = room.x; x < room.x + room.width; x += 1) {
        if (!isFloor(session.dungeon, { x, y })) continue;
        if (!best || distance({ x, y }, centre) < distance(best, centre)) best = { x, y };
      }
    }
    return best!;
  }

  /**
   * The viewer carries a torch and the other player does not, so the only thing that could reveal
   * them is light reaching across from the viewer's room. A carried torch is itself seen from any
   * distance with a clear line to it, which is a sight rule rather than a radius (see #61).
   */
  it("lights nothing of the next room from the middle of this one", () => {
    const first = testPlayer("first");
    const second = testPlayer("second");
    const session = testSession([first, second], "vault-run");
    const { rooms } = session.dungeon;
    expect(rooms.length).toBeGreaterThan(1);

    // Rooms are no longer a chain, so a pair is any two rooms with a wall between their middles. A
    // straight corridor between aligned doorways is a clear line, and light crossing that is correct.
    let walledOff = 0;
    for (const [index, other] of rooms.slice(1).entries()) {
      first.position = middleOf(session, rooms[index]!);
      second.position = middleOf(session, other);
      if (hasLineOfSight(session.dungeon, first.position, second.position)) continue;
      walledOff += 1;

      first.carryingTorch = true;
      second.carryingTorch = false;
      expect(visibilityFrameForPlayer(session, first).visiblePlayerIds.has("second")).toBe(false);

      first.carryingTorch = false;
      second.carryingTorch = true;
      expect(visibilityFrameForPlayer(session, second).visiblePlayerIds.has("first")).toBe(false);
    }
    expect(walledOff).toBeGreaterThan(0);
  });
});

describe("voice range", () => {
  it("includes visible peers with attenuation and omits unseen peers", () => {
    const viewer = testPlayer("viewer", { position: at(2, 2) });
    const visible = testPlayer("visible", { position: at(2, 2, 1) });
    const hidden = testPlayer("hidden", { position: at(14, 6) });
    const session = testSession([viewer, visible, hidden]);

    const range = voiceRangeForPlayer(session, viewer);

    expect(range.peers.map((peer) => peer.playerId)).toEqual(["visible"]);
    expect(range.peers[0]?.distance).toBe(1);
    expect(range.peers[0]?.volume).toBe(1);
  });
});

describe("player-to-player sight (#61)", () => {
  /**
   * A left room, a corridor east through a two-tile door, and a pocket south of the corridor's far
   * end. Between them it has inside and outside corners, door edges, and long diagonals.
   */
  const ROOMS_AND_CORRIDOR = [
    "##################",
    "#......###########",
    "#......###########",
    "#................#",
    "#................#",
    "#......######....#",
    "#......######....#",
    "#......######....#",
    "##################",
  ];
  const DOOR_ID = "55555555-5555-4555-8555-555555555555";

  /** An open room far wider than two torches, so distance alone never hides anyone in it. */
  const OPEN_ROOM = [
    "##########################",
    ...Array.from({ length: 16 }, () => "#........................#"),
    "##########################",
  ];

  type Player = ReturnType<typeof testPlayer>;
  type TestSession = ReturnType<typeof testSession>;

  function world(tiles: string[], players: Player[]): TestSession {
    const session = testSession(players);
    session.dungeon.map = flatMap(tiles);
    session.dungeon.doors = [];
    session.dungeon.lightSources = [];
    session.dungeon.monsters = [];
    session.dungeon.rooms = [];
    return session;
  }

  function sees(session: TestSession, viewer: Player, other: Player): boolean {
    return visibilityFrameForPlayer(session, viewer).visiblePlayerIds.has(other.id);
  }

  /** Floor tile centres, each nudged off-centre so rays start from inside a tile too. */
  function floorPositions(tiles: string[], skip: (x: number, y: number) => boolean = () => false) {
    const positions: Vector2[] = [];
    tiles.forEach((row, y) => {
      [...row].forEach((tile, x) => {
        if (tile !== "." || skip(x, y)) return;
        const nudge = (x + y) % 2 === 0 ? { x: 0.3, y: -0.25 } : { x: -0.2, y: 0.3 };
        positions.push({ x: x + nudge.x, y: y + nudge.y });
      });
    });
    return positions;
  }

  /** Every unordered pair, each as fresh players so nothing seen for one pair lingers into the next. */
  function eachPair(session: TestSession, positions: Vector2[], check: (a: Player, b: Player) => void) {
    for (const [index, first] of positions.entries()) {
      for (const second of positions.slice(index + 1)) {
        const a = testPlayer("a", { position: first });
        const b = testPlayer("b", { position: second });
        session.players = new Map([
          [a.id, a],
          [b.id, b],
        ]);
        check(a, b);
      }
    }
  }

  const where = (player: Player) => `(${player.position.x}, ${player.position.y})`;

  it("keeps two torch carriers in one open room in sight of each other everywhere in it", () => {
    const positions = floorPositions(OPEN_ROOM).filter((_, index) => index % 7 === 0);
    const session = world(OPEN_ROOM, []);

    eachPair(session, positions, (a, b) => {
      expect(sees(session, a, b), `${where(a)} sees ${where(b)}`).toBe(true);
      expect(sees(session, b, a), `${where(b)} sees ${where(a)}`).toBe(true);
    });
  });

  it.each([
    ["closed", false],
    ["open", true],
  ])("gives the same answer from both ends around corners and a %s door", (_label, open) => {
    const door = { id: DOOR_ID, position: { x: 9.5, y: 3.5 }, size: 2, open, lock: null };
    // Nobody stands inside a closed door.
    const positions = floorPositions(ROOMS_AND_CORRIDOR, (x, y) => !open && coversTile(door, x, y));
    const session = world(ROOMS_AND_CORRIDOR, []);
    session.dungeon.doors = [door];

    const mismatches: string[] = [];
    let mutual = 0;
    let hidden = 0;
    eachPair(session, positions, (a, b) => {
      const aSeesB = sees(session, a, b);
      const bSeesA = sees(session, b, a);
      if (aSeesB !== bSeesA) mismatches.push(`${where(a)} ${aSeesB ? "sees" : "misses"} ${where(b)}`);
      if (aSeesB && bSeesA) mutual += 1;
      if (!aSeesB && !bSeesA) hidden += 1;
    });

    expect(mismatches).toEqual([]);
    // Both outcomes occur, so the sweep really went around corners rather than across open floor.
    expect(mutual).toBeGreaterThan(0);
    expect(hidden).toBeGreaterThan(0);
  });

  /** Walks one tick at a time, computing both players' frames each tick as the server does. */
  function walk(session: TestSession, viewer: Player, walker: Player, path: Vector2[]) {
    const seen: boolean[] = [];
    const seenBack: boolean[] = [];
    for (const position of path) {
      walker.position = position;
      const frame = visibilityFrameForPlayer(session, viewer);
      const walkerFrame = visibilityFrameForPlayer(session, walker);
      seen.push(frame.visiblePlayerIds.has(walker.id));
      seenBack.push(walkerFrame.visiblePlayerIds.has(viewer.id));

      // Voice follows exactly the same visible set, in both directions.
      const heard = voiceRangeForPlayer(session, viewer, frame).peers.map((peer) => peer.playerId);
      expect(heard).toEqual(seen.at(-1) ? [walker.id] : []);
      const heardBack = voiceRangeForPlayer(session, walker, walkerFrame).peers.map(
        (peer) => peer.playerId,
      );
      expect(heardBack).toEqual(seenBack.at(-1) ? [viewer.id] : []);
    }
    return { seen, seenBack };
  }

  function changes(states: boolean[]): number {
    return states.slice(1).filter((state, index) => state !== states[index]).length;
  }

  /** Roughly one server tick of walking at `PLAYER_MOVE_SPEED`. */
  const STEP = 0.3;

  it("does not flicker a player walking along the rim of a torch's light", () => {
    const centre = { x: 12, y: 8 };
    const carrier = testPlayer("carrier", { position: centre });
    const walker = testPlayer("walker", { position: centre, carryingTorch: false });
    const session = world(OPEN_ROOM, [carrier, walker]);

    // Step out to the rim, then around half a circle along it.
    const path: Vector2[] = [];
    for (let r = PLAYER_TORCH_LIGHT_RADIUS - 2; r < PLAYER_TORCH_LIGHT_RADIUS; r += STEP) {
      path.push({ x: centre.x + r, y: centre.y });
    }
    for (let angle = 0; angle <= Math.PI; angle += STEP / PLAYER_TORCH_LIGHT_RADIUS) {
      path.push({
        x: centre.x + Math.cos(angle) * PLAYER_TORCH_LIGHT_RADIUS,
        y: centre.y + Math.sin(angle) * PLAYER_TORCH_LIGHT_RADIUS,
      });
    }

    const { seen, seenBack } = walk(session, carrier, walker, path);

    expect(seen.every(Boolean)).toBe(true);
    // The walker has no torch but stands in the carrier's light, so they see each other.
    expect(seenBack.every(Boolean)).toBe(true);
  });

  it("lets a player walking out of the light go once, rather than lingering", () => {
    const centre = { x: 6, y: 8 };
    const carrier = testPlayer("carrier", { position: centre });
    const walker = testPlayer("walker", { position: centre, carryingTorch: false });
    const session = world(OPEN_ROOM, [carrier, walker]);

    const path: Vector2[] = [];
    for (let x = centre.x + 2; x <= centre.x + PLAYER_TORCH_LIGHT_RADIUS + 4; x += STEP) {
      path.push({ x, y: centre.y + 0.4 });
    }

    const { seen, seenBack } = walk(session, carrier, walker, path);

    expect(seen[0]).toBe(true);
    expect(seen.at(-1)).toBe(false);
    expect(changes(seen)).toBe(1);
    // A torch is seen from any distance with a clear line to it, so the walker keeps the carrier.
    expect(seenBack.every(Boolean)).toBe(true);
  });

  it("drops two torch carriers out of each other's sight together, once, around a corner", () => {
    const watcher = testPlayer("watcher", { position: { x: 3, y: 6.5 } });
    const walker = testPlayer("walker", { position: { x: 4, y: 3.5 } });
    const session = world(ROOMS_AND_CORRIDOR, [watcher, walker]);

    // East along the corridor, then south into the far pocket behind the wall block.
    const path: Vector2[] = [];
    for (let x = 4; x <= 15; x += STEP) path.push({ x, y: 3.6 });
    for (let y = 3.6; y <= 7; y += STEP) path.push({ x: 15, y });

    const { seen, seenBack } = walk(session, watcher, walker, path);

    expect(seen).toEqual(seenBack);
    expect(seen[0]).toBe(true);
    expect(seen.at(-1)).toBe(false);
    expect(changes(seen)).toBe(1);
  });

  it("hides a player at once when a door closes between them, despite the margin", () => {
    const door = { id: DOOR_ID, position: { x: 9.5, y: 3.5 }, size: 2, open: true, lock: null };
    const near = testPlayer("near", { position: { x: 7, y: 3.5 } });
    // Just past the door's far edge, well inside the margin around the door's own tiles.
    const far = testPlayer("far", { position: { x: 11.4, y: 3.5 } });
    const session = world(ROOMS_AND_CORRIDOR, [near, far]);
    session.dungeon.doors = [door];

    expect(sees(session, near, far)).toBe(true);
    expect(sees(session, far, near)).toBe(true);

    door.open = false;

    expect(sees(session, near, far)).toBe(false);
    expect(sees(session, far, near)).toBe(false);
  });

  describe("without a torch", () => {
    it("is seen inside a carrier's light and sees the carrier back", () => {
      const carrier = testPlayer("carrier", { position: { x: 6, y: 8 } });
      const dark = testPlayer("dark", { position: { x: 10, y: 8 }, carryingTorch: false });
      const session = world(OPEN_ROOM, [carrier, dark]);

      expect(sees(session, carrier, dark)).toBe(true);
      expect(sees(session, dark, carrier)).toBe(true);
    });

    it("sees a distant carrier by their torch while staying unseen in the dark", () => {
      // The deliberate asymmetry: a torch shows from afar, someone standing in the dark does not.
      const carrier = testPlayer("carrier", { position: { x: 4, y: 8 } });
      const dark = testPlayer("dark", { position: { x: 20, y: 8 }, carryingTorch: false });
      const session = world(OPEN_ROOM, [carrier, dark]);

      expect(sees(session, dark, carrier)).toBe(true);
      expect(sees(session, carrier, dark)).toBe(false);
      expect(voiceRangeForPlayer(session, dark).peers.map((peer) => peer.playerId)).toEqual([
        "carrier",
      ]);
      expect(voiceRangeForPlayer(session, carrier).peers).toEqual([]);
    });

    it("leaves two torchless players in the dark to each other", () => {
      const first = testPlayer("first", { position: { x: 6, y: 8 }, carryingTorch: false });
      const second = testPlayer("second", { position: { x: 8, y: 8 }, carryingTorch: false });
      const session = world(OPEN_ROOM, [first, second]);

      expect(sees(session, first, second)).toBe(false);
      expect(sees(session, second, first)).toBe(false);
    });
  });

  describe("when downed", () => {
    it("keeps the downed player's torch burning, so the party can find them", () => {
      const downed = testPlayer("downed", { position: { x: 20, y: 8 }, health: 0 });
      const rescuer = testPlayer("rescuer", { position: { x: 4, y: 8 }, carryingTorch: false });
      const session = world(OPEN_ROOM, [downed, rescuer]);

      const frame = visibilityFrameForPlayer(session, rescuer);

      expect(frame.visiblePlayerIds.has("downed")).toBe(true);
      expect(frame.dungeon.lightSources.map((light) => light.id)).toEqual(["downed"]);
      // It lights the ground around them for the rescuer, as it already did for the downed player.
      expect(tileAt(clientMap(session, rescuer), 17, 8)).toBe(".");
      // The rescuer has no torch and stands far outside the downed player's light.
      expect(sees(session, downed, rescuer)).toBe(false);
    });

    it("sees and is seen by a torch-carrying ally, both ways", () => {
      const downed = testPlayer("downed", { position: { x: 20, y: 8 }, health: 0 });
      const ally = testPlayer("ally", { position: { x: 4, y: 8 } });
      const session = world(OPEN_ROOM, [downed, ally]);

      expect(sees(session, ally, downed)).toBe(true);
      expect(sees(session, downed, ally)).toBe(true);
    });

    it("puts a disconnected player's torch out", () => {
      const gone = testPlayer("gone", { position: { x: 20, y: 8 }, connected: false });
      const other = testPlayer("other", { position: { x: 4, y: 8 }, carryingTorch: false });
      const session = world(OPEN_ROOM, [gone, other]);

      expect(sees(session, other, gone)).toBe(false);
    });
  });
});

describe("discovery memory", () => {
  function discoveredCount(player: { discoveredTiles: Uint8Array }): number {
    return player.discoveredTiles.reduce((total, seen) => total + seen, 0);
  }

  function partyOfOne() {
    let id = 0;
    const store = new SessionStore({
      dungeon: { dungeonId: "ember-vault" },
      createPlayerId: () => `player-${(id += 1)}`,
      createSessionId: () => `session-${(id += 1)}`,
      createResumeToken: () => `token-${(id += 1)}`,
      createRoomCode: () => "ROOM01",
    });
    const session = store.createSession();
    const joined = store.join(joinRequest({ roomCode: session.roomCode, playerName: "Grix" }));
    if (!joined.ok) throw new Error(joined.message);
    store.setAppearance(joined.player.id, DEFAULT_APPEARANCE);
    return { store, session, player: joined.player };
  }

  it("survives a reconnect", () => {
    const { store, session, player } = partyOfOne();
    visibilityFrameForPlayer(session, player);
    const remembered = discoveredCount(player);
    expect(remembered).toBeGreaterThan(0);

    store.markDisconnected(player.id);
    const resumed = store.join(
      joinRequest({
        roomCode: session.roomCode,
        playerName: "Grix",
        resumeToken: player.resumeToken,
      }),
    );
    if (!resumed.ok) throw new Error(resumed.message);

    expect(resumed.player).toBe(player);
    expect(discoveredCount(resumed.player)).toBe(remembered);
  });

  it("is cleared by a hub and run transition, and sized for the new world", () => {
    const { session, player } = partyOfOne();
    visibilityFrameForPlayer(session, player);
    expect(discoveredCount(player)).toBeGreaterThan(0);

    player.ready = true;
    expect(startRun(session, 1)).toEqual({ ok: true });
    expect(discoveredCount(player)).toBe(0);
    expect(player.discoveredTiles.length).toBe(session.dungeon.map.width * session.dungeon.map.height);

    visibilityFrameForPlayer(session, player);
    expect(discoveredCount(player)).toBeGreaterThan(0);

    returnToHub(session, true);
    expect(discoveredCount(player)).toBe(0);
    expect(player.discoveredTiles.length).toBe(session.dungeon.map.width * session.dungeon.map.height);
  });

  it("reveals a room exactly when the first tile of it is lit", () => {
    const viewer = testPlayer("viewer", { position: { x: 1, y: 1 }, carryingTorch: false });
    const session = testSession([viewer]);
    session.dungeon.map = flatMap(["##########", "#........#", "##########"]);
    session.dungeon.doors = [];
    session.dungeon.lightSources = [
      { id: "77777777-7777-4777-8777-777777777777", name: "Torch", kind: "fixed", position: { x: 3, y: 1 }, radius: 0 },
    ];
    session.dungeon.rooms = [
      { id: "near", name: "Near", x: 2, y: 1, width: 3, height: 1 },
      { id: "far", name: "Far", x: 6, y: 1, width: 3, height: 1 },
    ] as RoomState[];

    const first = visibilityFrameForPlayer(session, viewer);
    // The torch lights only (3,1), the first tile of "near"; "far" has none lit yet.
    expect(first.dungeon.rooms.map((room) => room.id)).toEqual(["near"]);

    session.dungeon.lightSources = [
      { id: "88888888-8888-4888-8888-888888888888", name: "Torch", kind: "fixed", position: { x: 8, y: 1 }, radius: 0 },
    ];
    const second = visibilityFrameForPlayer(session, viewer);
    expect(second.dungeon.rooms.map((room) => room.id)).toEqual(["near", "far"]);
  });
});

describe("map discovery deltas", () => {
  function tilesSent(map: ReturnType<typeof takeMapDiscovery>): number {
    return map.discovered.reduce((total, run) => total + run.tiles.length, 0);
  }

  function snapshotMap(session: Parameters<typeof takeMapDiscovery>[0], viewer: Parameters<typeof takeMapDiscovery>[1]) {
    visibilityFrameForPlayer(session, viewer);
    return takeMapDiscovery(session, viewer);
  }

  it("opens with a baseline of everything discovered", () => {
    const viewer = testPlayer("viewer", { position: at(2, 2) });
    const session = testSession([viewer]);

    const first = snapshotMap(session, viewer);

    expect(first.reset).toBe(true);
    expect(tilesSent(first)).toBeGreaterThan(0);
    expect(tilesSent(first)).toBe(viewer.discoveredTiles.reduce((total, seen) => total + seen, 0));
  });

  it("sends nothing again while the viewer stands still", () => {
    const viewer = testPlayer("viewer", { position: at(2, 2) });
    const session = testSession([viewer]);
    snapshotMap(session, viewer);

    const second = snapshotMap(session, viewer);

    expect(second.reset).toBe(false);
    expect(second.discovered).toEqual([]);
  });

  it("sends only tiles discovered since the last snapshot, and never one twice", () => {
    const viewer = testPlayer("viewer", { position: at(2, 2) });
    const session = testSession([viewer]);
    let client = applyMapDiscovery(null, snapshotMap(session, viewer));
    const seen = new Set<string>();
    client.tiles.forEach((row, y) => [...row].forEach((tile, x) => tile !== " " && seen.add(`${x},${y}`)));

    viewer.position = at(12, 6);
    const delta = snapshotMap(session, viewer);

    expect(delta.reset).toBe(false);
    for (const run of delta.discovered) {
      for (let n = 0; n < run.tiles.length; n += 1) {
        expect(seen.has(`${run.x + n},${run.y}`)).toBe(false);
      }
    }
    client = applyMapDiscovery(client, delta);

    // The accumulated map is exactly what the viewer has discovered, tile for tile.
    const { map } = session.dungeon;
    for (let y = 0; y < map.height; y += 1) {
      for (let x = 0; x < map.width; x += 1) {
        const known = viewer.discoveredTiles[y * map.width + x] === 1;
        expect(client.tiles[y]![x] !== " ").toBe(known);
        if (known) expect(client.tiles[y]![x]).toBe(map.tiles[y]![x] === "#" ? "#" : ".");
      }
    }
  });

  it("never reveals a tile the viewer has not discovered", () => {
    const viewer = testPlayer("viewer", { position: at(2, 2) });
    const session = testSession([viewer]);
    const { width } = session.dungeon.map;

    for (const position of [at(2, 2), at(6, 4), at(12, 6)]) {
      viewer.position = position;
      const delta = snapshotMap(session, viewer);
      for (const run of delta.discovered) {
        for (let n = 0; n < run.tiles.length; n += 1) {
          expect(viewer.discoveredTiles[run.y * width + run.x + n]).toBe(1);
        }
      }
    }
  });

  it("sends a fresh baseline when the client has to start over, such as after a reconnect", () => {
    const viewer = testPlayer("viewer", { position: at(2, 2) });
    const session = testSession([viewer]);
    const first = snapshotMap(session, viewer);

    viewer.mapSyncedTo = null;
    const again = snapshotMap(session, viewer);

    expect(again.reset).toBe(true);
    expect(tilesSent(again)).toBe(tilesSent(first));
  });

  it("starts over for a rebuilt world, and carries nothing of the old one", () => {
    const viewer = testPlayer("viewer", { position: at(2, 2) });
    const session = testSession([viewer]);
    snapshotMap(session, viewer);

    session.dungeon.map = flatMap(["#####", "#...#", "#####"]);
    session.dungeon.doors = [];
    viewer.discoveredTiles = new Uint8Array(0);
    viewer.pendingDiscovery = [];
    viewer.position = { x: 2, y: 1 };
    const next = snapshotMap(session, viewer);

    expect(next).toMatchObject({ reset: true, width: 5, height: 3 });
    expect(next.discovered.every((run) => run.y < 3 && run.x + run.tiles.length <= 5)).toBe(true);
  });

  it("does not queue discoveries for a viewer whose client has no baseline", () => {
    const viewer = testPlayer("viewer", { position: at(2, 2) });
    const session = testSession([viewer]);

    visibilityFrameForPlayer(session, viewer);

    expect(viewer.pendingDiscovery).toEqual([]);
  });
});

describe("lit tiles in snapshots", () => {
  /** Every tile a snapshot's lit runs cover, as `"x,y"` keys. */
  function litKeys(map: ReturnType<typeof takeMapDiscovery>): Set<string> {
    const keys = new Set<string>();
    for (const [x, y, length] of map.lit) {
      for (let offset = 0; offset < length; offset += 1) keys.add(`${x + offset},${y}`);
    }
    return keys;
  }

  function snapshotMap(session: Parameters<typeof takeMapDiscovery>[0], viewer: Parameters<typeof takeMapDiscovery>[1]) {
    visibilityFrameForPlayer(session, viewer);
    return takeMapDiscovery(session, viewer);
  }

  it("matches the viewer's visible tiles exactly, as sorted, non-overlapping row runs", () => {
    const viewer = testPlayer("viewer", { position: at(2, 2) });
    const session = testSession([viewer]);

    const map = snapshotMap(session, viewer);
    const visible = visibleTilesForPlayer(session, viewer);
    const expected = new Set<string>();
    for (let n = 0; n < visible.size; n += 1) {
      const index = visible.indexAt(n);
      expected.add(`${index % map.width},${Math.floor(index / map.width)}`);
    }

    expect(litKeys(map)).toEqual(expected);
    const starts = map.lit.map(([x, y]) => y * map.width + x);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(map.lit.every(([x, y, length]) => y < map.height && x + length <= map.width)).toBe(true);
    expect(map.lit.reduce((total, [, , length]) => total + length, 0)).toBe(expected.size);
  });

  it("only ever lights tiles the viewer has discovered", () => {
    const viewer = testPlayer("viewer", { position: at(2, 2) });
    const session = testSession([viewer]);

    const map = snapshotMap(session, viewer);

    for (const key of litKeys(map)) {
      const [x, y] = key.split(",").map(Number) as [number, number];
      expect(viewer.discoveredTiles[y * map.width + x], key).toBe(1);
    }
  });

  it("is the whole current set every snapshot, so a tile left behind goes out", () => {
    const viewer = testPlayer("viewer", { position: at(2, 2) });
    const session = testSession([viewer]);
    const first = litKeys(snapshotMap(session, viewer));

    const again = litKeys(snapshotMap(session, viewer));
    expect(again).toEqual(first);

    viewer.position = at(14, 6);
    const moved = litKeys(snapshotMap(session, viewer));
    expect([...first].some((key) => !moved.has(key))).toBe(true);
  });

  it("excludes a remembered room behind a wall, even within the torch's radius", () => {
    const viewer = testPlayer("viewer", { position: { x: 1, y: 1 } });
    const session = testSession([viewer]);
    session.dungeon.map = flatMap(["#####", "#.#.#", "#####"]);
    session.dungeon.doors = [];
    session.dungeon.lightSources = [];
    viewer.discoveredTiles = new Uint8Array(0);
    // Remembered from an earlier visit: discovered, but out of sight now.
    snapshotMap(session, viewer);
    viewer.discoveredTiles[1 * 5 + 3] = 1;

    const lit = litKeys(snapshotMap(session, viewer));

    expect(lit.has("1,1")).toBe(true);
    expect(lit.has("3,1")).toBe(false);
  });

  it("excludes what is behind a closed door", () => {
    const viewer = testPlayer("viewer", { position: { x: 2, y: 3 } });
    const session = testSession([viewer]);
    session.dungeon.map = flatMap([
      "##########",
      "##########",
      "#........#",
      "#........#",
      "#........#",
      "#........#",
      "##########",
    ]);
    session.dungeon.lightSources = [];
    session.dungeon.doors = [
      {
        id: "55555555-5555-4555-8555-555555555555",
        position: { x: 5.5, y: 3.5 },
        size: 4,
        open: false,
        lock: { type: "key", keyItemId: "copper-key" },
      },
    ];
    viewer.discoveredTiles = new Uint8Array(0);

    const lit = litKeys(snapshotMap(session, viewer));

    expect(lit.has("4,3")).toBe(true);
    expect(lit.has("8,3")).toBe(false);
  });

  it("lights nothing before a frame has been computed for the installed world", () => {
    const viewer = testPlayer("viewer", { position: at(2, 2) });
    const session = testSession([viewer]);

    expect(takeMapDiscovery(session, viewer).lit).toEqual([]);
  });

  it("sends a correct lit set with the baseline after a reconnect", () => {
    const viewer = testPlayer("viewer", { position: at(2, 2) });
    const session = testSession([viewer]);
    const before = litKeys(snapshotMap(session, viewer));

    viewer.mapSyncedTo = null;
    const rebased = snapshotMap(session, viewer);

    expect(rebased.reset).toBe(true);
    expect(litKeys(rebased)).toEqual(before);
  });
});

describe("hub visibility", () => {
  it("lights every tile of the hub for a viewer, and not every tile of a dungeon", () => {
    const viewer = testPlayer("viewer", { carryingTorch: false });
    const session = testSession([viewer], "hub");
    session.location = "hub";
    viewer.position = { ...session.spawnPoints[0]! };
    const { width, height } = session.dungeon.map;

    const hub = visibleTilesForPlayer(session, viewer);
    expect(hub.size).toBe(width * height);

    const dungeon = testSession([testPlayer("runner")]);
    const runner = dungeon.players.get("runner")!;
    const lit = visibleTilesForPlayer(dungeon, runner);
    expect(lit.size).toBeLessThan(dungeon.dungeon.map.width * dungeon.dungeon.map.height);
  });
});
