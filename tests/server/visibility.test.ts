import { describe, expect, it } from "vitest";
import {
  visibilityFrameForPlayer,
  visibleTilesForPlayer,
  voiceRangeForPlayer,
} from "../../src/server/game/visibility.js";
import { testPlayer, testSession } from "./fixtures.js";

describe("visibility frames", () => {
  it("sends a player only the party members and entities visible from their light radius", () => {
    const viewer = testPlayer("viewer", { position: { x: 2, y: 2 } });
    const nearby = testPlayer("nearby", { position: { x: 3, y: 2 } });
    const distant = testPlayer("distant", { position: { x: 14, y: 6 } });
    const session = testSession([viewer, nearby, distant]);

    const frame = visibilityFrameForPlayer(session, viewer);

    expect(frame.players.map((player) => player.id)).toEqual(["viewer", "nearby"]);
    expect(frame.dungeon.monsters).toEqual([]);
    expect(frame.dungeon.exits).toEqual([]);
    expect(JSON.stringify(frame)).not.toContain("distant");
  });

  it("keeps discovered geometry after the player moves away, without leaking entities there", () => {
    const viewer = testPlayer("viewer", { position: { x: 2, y: 2 } });
    const session = testSession([viewer]);

    const firstFrame = visibilityFrameForPlayer(session, viewer);
    expect(firstFrame.dungeon.map.tiles[2]?.[1]).toBe(".");

    viewer.position = { x: 12, y: 6 };
    const secondFrame = visibilityFrameForPlayer(session, viewer);

    expect(secondFrame.dungeon.map.tiles[2]?.[1]).toBe(",");
    expect(secondFrame.dungeon.loot.some((loot) => loot.name === "Minor Tonic")).toBe(false);
  });

  it("uses fixed lights to reveal geometry beyond a player's carried torch", () => {
    const viewer = testPlayer("viewer", {
      position: { x: 1, y: 1 },
      carryingTorch: false,
    });
    const session = testSession([viewer]);
    session.dungeon.map = {
      id: "test",
      name: "Test",
      width: 8,
      height: 3,
      tiles: ["########", "#......#", "########"],
    };
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

    expect(frame.dungeon.map.tiles[1]?.[6]).toBe(".");
    expect(frame.dungeon.lightSources.map((light) => light.name)).toEqual(["Torch Pillar"]);
  });
});

describe("line of sight", () => {
  it("does not mark tiles visible through walls", () => {
    const viewer = testPlayer("viewer", { position: { x: 2, y: 2 } });
    const session = testSession([viewer]);
    session.dungeon.map = {
      id: "test",
      name: "Test",
      width: 5,
      height: 3,
      tiles: ["#####", "#.#.#", "#####"],
    };
    viewer.position = { x: 1, y: 1 };
    const visible = visibleTilesForPlayer(session, viewer);

    expect(visible.has("3,1")).toBe(false);
  });
});

describe("voice range", () => {
  it("includes visible peers with attenuation and omits unseen peers", () => {
    const viewer = testPlayer("viewer", { position: { x: 2, y: 2 } });
    const visible = testPlayer("visible", { position: { x: 3, y: 2 } });
    const hidden = testPlayer("hidden", { position: { x: 14, y: 6 } });
    const session = testSession([viewer, visible, hidden]);

    const range = voiceRangeForPlayer(session, viewer);

    expect(range.peers.map((peer) => peer.playerId)).toEqual(["visible"]);
    expect(range.peers[0]?.distance).toBe(1);
    expect(range.peers[0]?.volume).toBe(1);
  });
});
