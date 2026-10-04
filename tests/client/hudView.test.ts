import { describe, expect, it } from "vitest";
import { initialSessionView, type SessionView } from "../../src/client/network/sessionState.js";
import {
  actionableError,
  barView,
  bankEntries,
  connectionLabel,
  controlsView,
  decayMessage,
  inventorySlotLabels,
  newServerAction,
  noticesView,
  placeStatusLabel,
  positionLabel,
  readyLabel,
  rosterEntries,
  roomCodeLabel,
  torchStatusLabel,
  vitalsView,
} from "../../src/client/state/hudView.js";
import {
  PLAYER_MAX_HEALTH,
  RESISTANCE_DECAY_WARNING_MS,
} from "../../src/shared/constants/game.js";
import type { InventoryItem, PlayerState, RunState } from "../../src/shared/types/core.js";

const SELF_ID = "8f1d6b0e-6a4a-4f2e-9d1c-2b3a4c5d6e7f";
const OTHER_ID = "9a2e7c1f-7b5b-4a3f-8e2d-3c4b5d6e7f80";

function player(name: string, overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: OTHER_ID,
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
    carryingPlayerId: null,
    carriedByPlayerId: null,
    bankedItems: [],
    ...overrides,
  };
}

function item(name: string): InventoryItem {
  return { id: "a1111111-1111-4111-8111-111111111111", name, kind: "tonic" };
}

function view(overrides: Partial<SessionView> = {}): SessionView {
  return { ...initialSessionView, ...overrides };
}

function run(overrides: Partial<RunState> = {}): RunState {
  return { elapsedMs: 0, decayStartsInMs: 600_000, decaying: false, decayPerSecond: 0, ...overrides };
}

describe("connection and error labels", () => {
  it("labels the phase until a snapshot says where the party is", () => {
    expect(connectionLabel(view({ phase: "offline" }))).toBe("offline");
    expect(connectionLabel(view({ phase: "failed" }))).toBe("connection lost");
    expect(connectionLabel(view({ phase: "inSession", location: null }))).toBe("in session");
  });

  it("names the hub and a run once the location is known", () => {
    expect(connectionLabel(view({ phase: "inSession", location: "hub" }))).toBe("in the hub");
    expect(connectionLabel(view({ phase: "inSession", location: "dungeon" }))).toBe("in a run");
  });

  it("falls back to a dash without a room code", () => {
    expect(roomCodeLabel(view())).toBe("-");
    expect(roomCodeLabel(view({ roomCode: "ABCD" }))).toBe("ABCD");
  });

  it("hides notImplemented errors and shows the rest", () => {
    expect(actionableError(view())).toBe("");
    expect(actionableError(view({ lastError: { code: "notImplemented", message: "later" } }))).toBe("");
    expect(actionableError(view({ lastError: { code: "rateLimited", message: "No." } }))).toBe("No.");
  });
});

describe("vitals", () => {
  it("clamps the fill ratio and rounds the text", () => {
    expect(barView(50, 100)).toEqual({ ratio: 0.5, text: "50" });
    expect(barView(150, 100).ratio).toBe(1);
    expect(barView(-5, 100).ratio).toBe(0);
    expect(barView(10, 0).ratio).toBe(0);
    expect(barView(33.6, 100).text).toBe("34");
  });

  it("shows empty bars without a self player", () => {
    const vitals = vitalsView(null);
    expect(vitals.health).toEqual({ ratio: 0, text: "0" });
    expect(vitals.resistance.ratio).toBe(0);
    expect(vitals.stamina.ratio).toBe(0);
  });

  it("reads the self player's numbers", () => {
    const vitals = vitalsView(player("Maya", { health: PLAYER_MAX_HEALTH }));
    expect(vitals.health.ratio).toBe(1);
  });

  it("formats position to two decimals", () => {
    expect(positionLabel({ x: 1, y: 2.345 })).toBe("1.00, 2.35");
  });
});

describe("notices", () => {
  it("stays silent about decay until it is close", () => {
    expect(decayMessage(null)).toBe("");
    expect(decayMessage(run())).toBe("");
    expect(decayMessage(run({ decayStartsInMs: RESISTANCE_DECAY_WARNING_MS }))).toBe(
      `Resistance starts falling in ${RESISTANCE_DECAY_WARNING_MS / 1000}s.`,
    );
    expect(decayMessage(run({ decaying: true, decayStartsInMs: 0 }))).toBe(
      "Resistance is falling. Get out of the dungeon.",
    );
  });

  it("shows hub notices only in the hub and decay only in a run", () => {
    const self = player("Maya", { id: SELF_ID });
    const hub = noticesView(
      view({ phase: "inSession", location: "hub", players: [self], selfId: SELF_ID, run: run({ decaying: true }) }),
      self,
    );
    expect(hub.decay).toBe("");
    expect(hub.gate).toContain("Waiting on Maya");
    expect(hub.torch).toContain("No torch");

    const dungeon = noticesView(
      view({ phase: "inSession", location: "dungeon", players: [self], selfId: SELF_ID, run: run({ decaying: true }) }),
      self,
    );
    expect(dungeon.decay).toContain("Resistance is falling");
    expect(dungeon.gate).toBe("");
    expect(dungeon.outcome).toBe("");
  });

  it("keeps the last outcome up in the hub", () => {
    const outcome = noticesView(
      view({ phase: "inSession", location: "hub", runOutcome: { kind: "lost", banked: 0 } }),
      null,
    );
    expect(outcome.outcome).toBe("You went down. Everything you carried is gone.");
  });

  it("shows nothing before the session starts", () => {
    expect(noticesView(view({ phase: "connected", location: "hub" }), null)).toEqual({
      decay: "",
      gate: "",
      torch: "",
      outcome: "",
    });
  });
});

describe("controls", () => {
  it("disables everything outside a session", () => {
    const controls = controlsView(view({ phase: "connected" }), null);
    expect(controls.sessionControlsDisabled).toBe(true);
    expect(controls.actionsDisabled).toBe(true);
    expect(controls.useDisabled).toEqual([true, true, true]);
  });

  it("disables actions for a downed player but keeps ready and leave", () => {
    const self = player("Maya", { id: SELF_ID, health: 0 });
    const controls = controlsView(view({ phase: "inSession", selfId: SELF_ID, players: [self] }), self);
    expect(controls.sessionControlsDisabled).toBe(false);
    expect(controls.actionsDisabled).toBe(true);
  });

  it("enables only the occupied use slots", () => {
    const self = player("Maya", { id: SELF_ID, inventory: [item("Tonic")] });
    const controls = controlsView(view({ phase: "inSession", selfId: SELF_ID, players: [self] }), self);
    expect(controls.actionsDisabled).toBe(false);
    expect(controls.useDisabled).toEqual([false, true, true]);
  });

  it("flips Carry to Drop while carrying", () => {
    const carrying = player("Maya", { id: SELF_ID, carryingPlayerId: OTHER_ID });
    expect(controlsView(view({ phase: "inSession" }), carrying).carryLabel).toBe("Drop");
    expect(controlsView(view({ phase: "inSession" }), player("Maya")).carryLabel).toBe("Carry");
  });

  it("labels the ready button", () => {
    expect(readyLabel(true)).toBe("Ready ✓");
    expect(readyLabel(false)).toBe("Ready");
  });
});

describe("server action text", () => {
  it("applies an action only once", () => {
    expect(newServerAction(view({ lastAction: null }), null)).toBeNull();
    expect(newServerAction(view({ lastAction: "Hit" }), null)).toBe("Hit");
    expect(newServerAction(view({ lastAction: "Hit" }), "Hit")).toBeNull();
    expect(newServerAction(view({ lastAction: "Miss" }), "Hit")).toBe("Miss");
  });
});

describe("inventory and bank", () => {
  it("always shows three slots", () => {
    expect(inventorySlotLabels([])).toEqual(["-", "-", "-"]);
    expect(inventorySlotLabels([item("Tonic"), item("Salve")])).toEqual(["Tonic", "Salve", "-"]);
  });

  it("reports the torch", () => {
    expect(torchStatusLabel(null)).toBe("none");
    expect(torchStatusLabel(player("Maya", { carryingTorch: true }))).toBe("carried");
  });

  it("shows an empty bank placeholder and counts duplicates", () => {
    expect(bankEntries([])).toEqual([{ text: "Nothing banked yet", empty: true }]);
    expect(bankEntries([item("Tonic"), item("Tonic"), item("Salve")])).toEqual([
      { text: "Tonic x2", empty: false },
      { text: "Salve", empty: false },
    ]);
  });
});

describe("roster", () => {
  it("describes each player's standing", () => {
    const entries = rosterEntries(
      view({
        selfId: SELF_ID,
        players: [
          player("Maya", { id: SELF_ID, ready: true }),
          player("Sam", { health: 0, carriedByPlayerId: SELF_ID }),
          player("Iris", { connected: false }),
          player("Bo", { carryingPlayerId: SELF_ID }),
          player("Al", { health: 0 }),
          player("Cy"),
        ],
      }),
    );

    expect(entries.map((entry) => entry.text)).toEqual([
      "Maya · 100hp · ready",
      "Sam · 0hp · down, being carried",
      "Iris · 100hp · disconnected",
      "Bo · 100hp · carrying",
      "Al · 0hp · down",
      "Cy · 100hp · waiting",
    ]);
    expect(entries[0]).toMatchObject({ self: true, offline: false });
    expect(entries[2]).toMatchObject({ self: false, offline: true });
  });
});

describe("place", () => {
  it("is a dash without a dungeon", () => {
    expect(placeStatusLabel(view(), null)).toBe("-");
  });
});
