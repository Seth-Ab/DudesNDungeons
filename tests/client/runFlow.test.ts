import { describe, expect, it } from "vitest";
import {
  bankSummary,
  entranceMessage,
  entranceStatus,
  gatePrompt,
  outcomeMessage,
  placeLabel,
  rejectionMessage,
  roomAt,
  runOutcome,
  torchNotice,
} from "../../src/client/state/runFlow.js";
import { TILE_SCALE } from "../../src/shared/constants/game.js";
import type { InventoryItem, PlayerState, RoomState } from "../../src/shared/types/core.js";

function player(name: string, overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: "8f1d6b0e-6a4a-4f2e-9d1c-2b3a4c5d6e7f",
    name,
    position: { x: 0, y: 0 },
    facing: { x: 0, y: 1 },
    health: 100,
    resistance: 40,
    stamina: 100,
    ready: false,
    connected: true,
    inventory: [],
    carryingTorch: false,
    bankedItems: [],
    ...overrides,
  };
}

function item(
  name: string,
  kind: Exclude<InventoryItem["kind"], "skillScroll"> = "tonic",
): InventoryItem {
  return { id: "a1111111-1111-4111-8111-111111111111", name, kind };
}

/** The Torch Supply as `content/dungeons/hub.json` authors it, scaled the way the server scales it. */
function torchSupply(): RoomState {
  return {
    id: "torch-supply",
    name: "Torch Supply",
    kind: "hall",
    x: 14 * TILE_SCALE,
    y: 1 * TILE_SCALE,
    width: 6 * TILE_SCALE,
    height: 5 * TILE_SCALE,
  };
}

describe("the gate", () => {
  it("opens only when every reserved slot is connected and ready", () => {
    const party = [
      player("Maya", { ready: true }),
      player("Sam", { ready: true }),
    ];

    expect(entranceStatus(party)).toEqual({ kind: "ready" });
  });

  it("names who the party is waiting on", () => {
    const party = [
      player("Maya", { ready: true }),
      player("Sam", { ready: false }),
      player("Iris", { ready: false }),
    ];

    expect(entranceStatus(party)).toEqual({ kind: "waiting", waitingOn: ["Sam", "Iris"] });
    expect(entranceMessage(entranceStatus(party))).toBe("Waiting on Sam and Iris to ready up.");
  });

  // The server counts a disconnected slot against the party even while its owner is ready, because
  // the slot is still reserved. A client that ignored that would promise a gate that will not open.
  it("counts a disconnected member as not ready, however they left the game", () => {
    const party = [player("Maya", { ready: true }), player("Sam", { ready: true, connected: false })];

    expect(entranceStatus(party)).toEqual({ kind: "waiting", waitingOn: ["Sam"] });
  });

  it("treats an empty party as not ready rather than unanimously ready", () => {
    expect(entranceStatus([])).toEqual({ kind: "waiting", waitingOn: [] });
    expect(entranceMessage(entranceStatus([]))).toBe("Waiting for the party to gather.");
  });

  it("counts rather than names under the gate itself", () => {
    const party = [player("Maya", { ready: true }), player("Sam"), player("Iris")];

    expect(gatePrompt(party)).toBe("Waiting on 2 of 3");
    expect(gatePrompt([player("Maya", { ready: true })])).toBe("The party is ready");
  });
});

describe("how a run ended", () => {
  it("counts what a survivor banked on the way out", () => {
    const before = player("Maya", { inventory: [item("Copper Key", "key")] });
    const after = player("Maya", { bankedItems: [item("Copper Key", "key")] });

    expect(runOutcome(before, after)).toEqual({ kind: "escaped", banked: 1 });
    expect(outcomeMessage(runOutcome(before, after))).toBe("You made it out and banked 1 item.");
  });

  it("says nothing was banked when a survivor carried nothing", () => {
    const outcome = runOutcome(player("Maya"), player("Maya"));

    expect(outcome).toEqual({ kind: "escaped", banked: 0 });
    expect(outcomeMessage(outcome)).toBe("You made it out, carrying nothing.");
  });

  // A wipe and an escape that left this player behind are the same pair of snapshots from the
  // client: `returnToHub` heals everyone on the way back. Both cost this player their carry, which
  // is what the message says, and neither claims anything about the rest of the party.
  it("reports a downed player's loss without guessing why the run ended", () => {
    const before = player("Maya", { health: 0, inventory: [item("Minor Tonic")] });
    const after = player("Maya", { health: 100 });

    expect(runOutcome(before, after)).toEqual({ kind: "lost", banked: 0 });
    expect(outcomeMessage(runOutcome(before, after))).toBe(
      "You went down. Everything you carried is gone.",
    );
  });

  it("never reports a negative bank if the server ever takes items back", () => {
    const before = player("Maya", { bankedItems: [item("Minor Tonic"), item("Minor Tonic")] });
    const after = player("Maya", { bankedItems: [item("Minor Tonic")] });

    expect(runOutcome(before, after)).toEqual({ kind: "escaped", banked: 0 });
  });
});

describe("naming the place", () => {
  it("finds the authored area a world position stands in", () => {
    const rooms = [torchSupply()];
    // Authored tile (16, 3), where hub.json puts a torch, scaled to its world centre.
    const inside = { x: 16 * TILE_SCALE + 1, y: 3 * TILE_SCALE + 1 };

    expect(roomAt(rooms, inside)?.name).toBe("Torch Supply");
    expect(placeLabel("The Ember Hearth", roomAt(rooms, inside))).toBe(
      "The Ember Hearth · Torch Supply",
    );
  });

  it("stops at the area's far edge rather than one tile past it", () => {
    const rooms = [torchSupply()];
    const lastTile = { x: (14 + 6) * TILE_SCALE - 1, y: 3 * TILE_SCALE };
    const pastIt = { x: (14 + 6) * TILE_SCALE, y: 3 * TILE_SCALE };

    expect(roomAt(rooms, lastTile)?.name).toBe("Torch Supply");
    expect(roomAt(rooms, pastIt)).toBeNull();
  });

  it("falls back to the world's name where no area covers the player", () => {
    expect(placeLabel("The Ember Hearth", null)).toBe("The Ember Hearth");
    expect(placeLabel(null, null)).toBe("-");
  });
});

describe("what the player is carrying", () => {
  it("warns in the hub only, where a torch can still be picked up", () => {
    const empty = player("Maya");

    expect(torchNotice(empty, "hub")).toContain("Torch Supply");
    expect(torchNotice(empty, "dungeon")).toBe("");
    expect(torchNotice(player("Maya", { carryingTorch: true }), "hub")).toBe("");
    expect(torchNotice(null, "hub")).toBe("");
  });

  it("counts duplicates in the bank instead of repeating them", () => {
    expect(bankSummary([item("Minor Tonic"), item("Minor Tonic"), item("Copper Key", "key")])).toEqual(
      ["Minor Tonic x2", "Copper Key"],
    );
    expect(bankSummary([])).toEqual([]);
  });
});

describe("refusals", () => {
  it("says something a player can act on for every reason the server can send", () => {
    for (const reason of [
      "blocked",
      "outOfRange",
      "onCooldown",
      "notPermitted",
      "targetMissing",
      "exhausted",
    ] as const) {
      const message = rejectionMessage(reason);
      expect(message).not.toContain(reason);
      expect(message.endsWith(".")).toBe(true);
    }
  });
});
