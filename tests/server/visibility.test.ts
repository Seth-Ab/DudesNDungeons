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
