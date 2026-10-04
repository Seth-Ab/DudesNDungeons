import { describe, expect, it } from "vitest";
import { initialSessionView, type SessionView } from "../../src/client/network/sessionState.js";
import {
  actionableError,
  actionPrompt,
  hotbarView,
  barView,
  bankEntries,
  connectionLabel,
  controlsView,
  decayMessage,
  healthBarView,
  LOW_HEALTH_RATIO,
  staminaRefused,
  vitalChange,
  newServerAction,
  noticesView,
  placeStatusLabel,
  positionLabel,
  readyLabel,
  rosterEntries,
  roomCodeLabel,
  toastMessages,
  torchStatusLabel,
  vitalsView,
} from "../../src/client/state/hudView.js";
import {
  PLAYER_MAX_HEALTH,
  PLAYER_MAX_STAMINA,
  RESISTANCE_DECAY_WARNING_MS,
} from "../../src/shared/constants/game.js";
import type { DungeonState, InventoryItem, LootState, PlayerState, RunState } from "../../src/shared/types/core.js";

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
    expect(vitals.health).toEqual({ ratio: 0, text: `0/${PLAYER_MAX_HEALTH}`, low: false });
    expect(vitals.resistance.ratio).toBe(0);
    expect(vitals.stamina.ratio).toBe(0);
  });

  it("reads the self player's numbers", () => {
    const vitals = vitalsView(player("Maya", { health: PLAYER_MAX_HEALTH }));
    expect(vitals.health.ratio).toBe(1);
  });

  it("shows health as current/max and flags low health below the threshold", () => {
    expect(healthBarView(80, 100)).toEqual({ ratio: 0.8, text: "80/100", low: false });
    expect(healthBarView(25, 100).low).toBe(false);
    expect(healthBarView(24, 100)).toMatchObject({ text: "24/100", low: true });
    expect(healthBarView(LOW_HEALTH_RATIO * 100 - 0.1, 100).low).toBe(true);
  });

  it("does not pulse for a downed player", () => {
    expect(healthBarView(0, 100)).toEqual({ ratio: 0, text: "0/100", low: false });
    expect(healthBarView(-3, 100).text).toBe("0/100");
    expect(vitalsView(null).health.low).toBe(false);
  });

  it("marks resistance as decaying only while the run says so and there is resistance left", () => {
    const self = player("Maya", { resistance: 10 });
    expect(vitalsView(self, run({ decaying: true })).resistance.decaying).toBe(true);
    expect(vitalsView(self, run()).resistance.decaying).toBe(false);
    expect(vitalsView(self, null).resistance.decaying).toBe(false);
    expect(vitalsView(player("Maya", { resistance: 0 }), run({ decaying: true })).resistance.decaying).toBe(false);
    expect(vitalsView(null, run({ decaying: true })).resistance.decaying).toBe(false);
  });

  it("shows stamina without a number", () => {
    expect(vitalsView(player("Maya", { stamina: PLAYER_MAX_STAMINA / 2 })).stamina).toEqual({ ratio: 0.5, text: "" });
  });

  it("reports damage and heals from consecutive health readings", () => {
    expect(vitalChange(100, 80)).toBe("damage");
    expect(vitalChange(80, 100)).toBe("heal");
    expect(vitalChange(80, 80)).toBeNull();
    expect(vitalChange(null, 80)).toBeNull();
    expect(vitalChange(80, null)).toBeNull();
  });

  it("flags a stamina refusal only when the counter goes up", () => {
    expect(staminaRefused(0, 1)).toBe(true);
    expect(staminaRefused(2, 2)).toBe(false);
    expect(staminaRefused(2, 0)).toBe(false);
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
    // Once it is falling the resistance bar shows it, so there is no toast.
    expect(decayMessage(run({ decaying: true, decayStartsInMs: 0 }))).toBe("");
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
      view({ phase: "inSession", location: "dungeon", players: [self], selfId: SELF_ID, run: run({ decayStartsInMs: 30000 }) }),
      self,
    );
    expect(dungeon.decay).toContain("Resistance starts falling in 30s");
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

describe("toast messages", () => {
  it("offers every source, empty when it has nothing to say", () => {
    expect(toastMessages(view(), null).map(({ key, text }) => [key, text])).toEqual([
      ["error", ""],
      ["decay", ""],
      ["torch", ""],
      ["gate", ""],
      ["outcome", ""],
    ]);
  });

  it("carries the error and decay text with their severities", () => {
    const self = player("Maya", { id: SELF_ID, carryingTorch: true });
    const messages = toastMessages(
      view({
        phase: "inSession",
        location: "dungeon",
        selfId: SELF_ID,
        players: [self],
        lastError: { code: "rateLimited", message: "Too fast." },
        run: run({ decayStartsInMs: 30000 }),
      }),
      self,
    );

    expect(messages.find((message) => message.key === "error")).toMatchObject({
      text: "Too fast.",
      severity: "error",
    });
    expect(messages.find((message) => message.key === "decay")).toMatchObject({
      text: "Resistance starts falling in 30s.",
      severity: "warning",
    });
  });
});

describe("controls", () => {
  it("disables everything outside a session", () => {
    const controls = controlsView(view({ phase: "connected" }), null);
    expect(controls.sessionControlsDisabled).toBe(true);
    expect(controls.actionsDisabled).toBe(true);
  });

  it("disables actions for a downed player but keeps ready and leave", () => {
    const self = player("Maya", { id: SELF_ID, health: 0 });
    const controls = controlsView(view({ phase: "inSession", selfId: SELF_ID, players: [self] }), self);
    expect(controls.sessionControlsDisabled).toBe(false);
    expect(controls.actionsDisabled).toBe(true);
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

const inSession = { phase: "inSession" as const, selfId: SELF_ID };

function dungeon(overrides: Partial<DungeonState> = {}): DungeonState {
  return {
    map: { name: "Test", width: 4, height: 4, tiles: [] },
    monsters: [],
    loot: [],
    doors: [],
    exits: [],
    rooms: [],
    ...overrides,
  } as unknown as DungeonState;
}

function loot(name: string, x: number): LootState {
  return { id: `loot-${name}`, name, kind: "tonic", position: { x, y: 0 }, pickedUp: false };
}

describe("hotbar", () => {
  it("always shows three slots with key hints, and marks empty ones", () => {
    const self = player("Maya", { id: SELF_ID, inventory: [item("Tonic")] });
    const slots = hotbarView(view({ ...inSession, players: [self] }), self);

    expect(slots.map((slot) => slot.keyHint)).toEqual(["1", "2", "3"]);
    expect(slots.map((slot) => slot.empty)).toEqual([false, true, true]);
    expect(slots[0]?.name).toBe("Tonic");
    expect(slots[0]?.icon).toBe("loot-tonic");
    expect(slots[1]?.icon).toBeNull();
    expect(slots.map((slot) => slot.disabled)).toEqual([false, true, true]);
  });

  it("picks the icon from the item kind", () => {
    const scroll: InventoryItem = {
      id: "b2222222-2222-4222-8222-222222222222",
      name: "Scroll",
      kind: "skillScroll",
      skillId: "iron-will",
    };
    const self = player("Maya", { id: SELF_ID, inventory: [scroll, { ...item("Key"), kind: "key" }] });
    const slots = hotbarView(view({ ...inSession, players: [self] }), self);
    expect(slots.map((slot) => slot.icon)).toEqual(["loot-skill-scroll", "loot-key", null]);
  });

  it("disables every slot when outside a session or downed", () => {
    const self = player("Maya", { id: SELF_ID, health: 0, inventory: [item("Tonic")] });
    expect(hotbarView(view({ ...inSession, players: [self] }), self)[0]?.disabled).toBe(true);
    const alive = player("Maya", { id: SELF_ID, inventory: [item("Tonic")] });
    expect(hotbarView(view({ phase: "connected" }), alive)[0]?.disabled).toBe(true);
  });
});

describe("action prompt", () => {
  const self = player("Maya", { id: SELF_ID });
  const origin = { x: 0, y: 0 };

  it("is hidden when nothing is in reach", () => {
    const v = view({ ...inSession, players: [self], dungeon: dungeon({ loot: [loot("Tonic", 5)] }) });
    expect(actionPrompt(v, self, origin)).toBeNull();
  });

  it("is hidden outside a session, without a dungeon, or while downed", () => {
    const d = dungeon({ loot: [loot("Tonic", 0.5)] });
    expect(actionPrompt(view({ phase: "connected", dungeon: d }), self, origin)).toBeNull();
    expect(actionPrompt(view({ ...inSession, players: [self] }), self, origin)).toBeNull();
    const downed = player("Maya", { id: SELF_ID, health: 0 });
    expect(actionPrompt(view({ ...inSession, players: [downed], dungeon: d }), downed, origin)).toBeNull();
  });

  it("names loot and its key", () => {
    const v = view({ ...inSession, players: [self], dungeon: dungeon({ loot: [loot("Tonic", 0.5)] }) });
    expect(actionPrompt(v, self, origin)).toEqual({ action: "pickup", keyHint: "F", text: "Pick up Tonic" });
  });

  it("ignores picked-up loot", () => {
    const taken = { ...loot("Tonic", 0.5), pickedUp: true };
    const v = view({ ...inSession, players: [self], dungeon: dungeon({ loot: [taken] }) });
    expect(actionPrompt(v, self, origin)).toBeNull();
  });

  it("offers a door and an exit with the interact key", () => {
    const door = { id: "door", position: { x: 0.5, y: 0 }, size: 1, open: false, locked: false };
    const doorView = view({ ...inSession, players: [self], dungeon: dungeon({ doors: [door] }) });
    expect(actionPrompt(doorView, self, origin)).toEqual({ action: "interact", keyHint: "E", text: "Open door" });

    const exit = { id: "exit", position: { x: 0.5, y: 0 } };
    const exitView = view({
      ...inSession,
      location: "hub",
      players: [self],
      dungeon: dungeon({ exits: [exit] } as Partial<DungeonState>),
    });
    expect(actionPrompt(exitView, self, origin)?.text).toBe("Enter the dungeon");
    expect(actionPrompt({ ...exitView, location: "dungeon" }, self, origin)?.text).toBe("Leave the dungeon");
  });

  it("skips an open door", () => {
    const door = { id: "door", position: { x: 0.5, y: 0 }, size: 1, open: true, locked: false };
    const v = view({ ...inSession, players: [self], dungeon: dungeon({ doors: [door] }) });
    expect(actionPrompt(v, self, origin)).toBeNull();
  });

  it("offers to lift a downed ally, and prefers that over loot", () => {
    const ana = player("Ana", { health: 0, position: { x: 0.4, y: 0 } });
    const v = view({
      ...inSession,
      players: [self, ana],
      dungeon: dungeon({ loot: [loot("Tonic", 0.5)] }),
    });
    expect(actionPrompt(v, self, origin)).toEqual({ action: "carry", keyHint: "C", text: "Lift Ana" });
  });

  it("does not offer a standing or already-carried ally", () => {
    const standing = player("Ana", { position: { x: 0.4, y: 0 } });
    const carried = player("Bo", { id: "c3333333-3333-4333-8333-333333333333", health: 0, carriedByPlayerId: "x" });
    const v = view({ ...inSession, players: [self, standing, carried], dungeon: dungeon() });
    expect(actionPrompt(v, self, origin)).toBeNull();
  });

  it("offers to drop whoever is being carried", () => {
    const ana = player("Ana", { health: 0, carriedByPlayerId: SELF_ID });
    const carrier = player("Maya", { id: SELF_ID, carryingPlayerId: ana.id });
    const v = view({ ...inSession, players: [carrier, ana], dungeon: dungeon() });
    expect(actionPrompt(v, carrier, origin)).toEqual({ action: "carry", keyHint: "C", text: "Drop Ana" });
  });
});
