import { describe, expect, it } from "vitest";
import {
  visibilityFrameForPlayer,
  visibleTilesForPlayer,
  voiceRangeForPlayer,
} from "../../src/server/game/visibility.js";
import { tileAt, tileOf } from "../../src/shared/game/movement.js";
import { at, testPlayer, testSession } from "./fixtures.js";

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

  it("keeps discovered geometry after the player moves away, without leaking entities there", () => {
    const viewer = testPlayer("viewer", { position: at(2, 2) });
    const session = testSession([viewer]);
    // A world tile inside the authored tile next to the spawn, lit from where the viewer starts.
    const nearSpawn = tileOf(at(1, 2));

    const firstFrame = visibilityFrameForPlayer(session, viewer);
    expect(tileAt(firstFrame.dungeon.map, nearSpawn.x, nearSpawn.y)).toBe(".");

    viewer.position = at(12, 6);
    const secondFrame = visibilityFrameForPlayer(session, viewer);

    expect(tileAt(secondFrame.dungeon.map, nearSpawn.x, nearSpawn.y)).toBe(",");
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

    expect(tileAt(frame.dungeon.map, 6, 1)).toBe(".");
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

    for (let x = 0; x <= 10; x += 1) {
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
        locked: true,
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
