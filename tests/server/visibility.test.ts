import { describe, expect, it } from "vitest";
import { visibilityFrameForPlayer, visibleTilesForPlayer } from "../../src/server/game/visibility.js";
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
