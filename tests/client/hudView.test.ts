import { afterEach, describe, expect, it } from "vitest";
import { resetBindings, setBinding } from "../../src/client/input/keyBindings.js";
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
  formatClock,
  hubStatusView,
  runClockView,
  healthBarView,
  LOW_HEALTH_RATIO,
  staminaRefused,
  vitalChange,
  newServerAction,
  noticesView,
  partyFrames,
  toastMessages,
  torchStatusLabel,
  vitalsView,
} from "../../src/client/state/hudView.js";
import {
  PLAYER_MAX_HEALTH,
  PLAYER_MAX_RESISTANCE,
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
    expect(hub.torch).toContain("No torch");

    const dungeon = noticesView(
      view({ phase: "inSession", location: "dungeon", players: [self], selfId: SELF_ID, run: run({ decayStartsInMs: 30000 }) }),
      self,
    );
    expect(dungeon.decay).toContain("Resistance starts falling in 30s");
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

describe("party frames", () => {
  const SAM_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const IRIS_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  it("leaves self out and gives each other player a frame", () => {
    const frames = partyFrames(
      view({
        selfId: SELF_ID,
        players: [player("Maya", { id: SELF_ID }), player("Sam", { id: SAM_ID, health: 40, resistance: 25 })],
      }),
    );

    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatchObject({ id: SAM_ID, name: "Sam", state: "waiting" });
    expect(frames[0]?.health).toMatchObject({ ratio: 0.4, text: "40/100" });
    expect(frames[0]?.resistance.ratio).toBeCloseTo(25 / PLAYER_MAX_RESISTANCE);
  });

  it("gives every standing a distinct icon shape", () => {
    const frames = partyFrames(
      view({
        selfId: SELF_ID,
        players: [
          player("Ready", { id: "1", ready: true }),
          player("Wait", { id: "2" }),
          player("Carry", { id: "3", carryingPlayerId: SELF_ID }),
          player("Down", { id: "4", health: 0 }),
          player("Lifted", { id: "5", health: 0, carriedByPlayerId: SELF_ID }),
          player("Gone", { id: "6", connected: false }),
        ],
      }),
    );

    expect(frames.map((frame) => frame.state)).toEqual([
      "ready",
      "waiting",
      "carrying",
      "downed",
      "beingCarried",
      "disconnected",
    ]);
    expect(new Set(frames.map((frame) => frame.icon)).size).toBe(6);
  });

  it("treats a disconnected player as disconnected even when downed", () => {
    const [frame] = partyFrames(
      view({ selfId: SELF_ID, players: [player("Gone", { id: SAM_ID, connected: false, health: 0 })] }),
    );
    expect(frame?.state).toBe("disconnected");
  });

  it("drops a frame as soon as the ally leaves the visible snapshot", () => {
    const sam = player("Sam", { id: SAM_ID });
    const iris = player("Iris", { id: IRIS_ID });
    const self = player("Maya", { id: SELF_ID });

    const before = partyFrames(view({ selfId: SELF_ID, players: [self, sam, iris] }));
    expect(before.map((frame) => frame.name)).toEqual(["Sam", "Iris"]);

    const after = partyFrames(view({ selfId: SELF_ID, players: [self, iris] }));
    expect(after.map((frame) => frame.name)).toEqual(["Iris"]);

    expect(partyFrames(view({ selfId: SELF_ID, players: [self] }))).toEqual([]);
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

afterEach(() => resetBindings());

describe("rebound keys", () => {
  const self = player("Maya", { id: SELF_ID, inventory: [item("Tonic")] });
  const origin = { x: 0, y: 0 };

  it("show in the action prompt for doors, exits, and loot", () => {
    setBinding("interact", "x");
    setBinding("pickup", "g");
    const door = { id: "door", position: { x: 0.5, y: 0 }, size: 1, open: false, locked: false };
    const doorView = view({ ...inSession, players: [self], dungeon: dungeon({ doors: [door] }) });
    expect(actionPrompt(doorView, self, origin)?.keyHint).toBe("X");

    const exit = { id: "exit", position: { x: 0.5, y: 0 } };
    const exitView = view({ ...inSession, players: [self], dungeon: dungeon({ exits: [exit] } as Partial<DungeonState>) });
    expect(actionPrompt(exitView, self, origin)?.keyHint).toBe("X");

    const lootView = view({ ...inSession, players: [self], dungeon: dungeon({ loot: [loot("Tonic", 0.5)] }) });
    expect(actionPrompt(lootView, self, origin)?.keyHint).toBe("G");
  });

  it("show on the hotbar slots", () => {
    setBinding("useSlot1", "z");
    const slots = hotbarView(view({ ...inSession, players: [self] }), self);
    expect(slots.map((slot) => slot.keyHint)).toEqual(["Z", "2", "3"]);
  });
});

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

describe("formatClock", () => {
  it("formats whole seconds as m:ss, and h:mm:ss past an hour", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(7_999)).toBe("0:07");
    expect(formatClock(125_000)).toBe("2:05");
    expect(formatClock(3_725_000)).toBe("1:02:05");
    expect(formatClock(-5)).toBe("0:00");
  });
});

describe("run clock", () => {
  const inRun = (overrides: Partial<RunState>): SessionView =>
    view({ phase: "inSession", location: "dungeon", run: run(overrides) });

  it("is hidden in the hub, before a snapshot, and outside a session", () => {
    expect(runClockView(view({ phase: "inSession", location: "hub", run: run() }))).toBeNull();
    expect(runClockView(view({ phase: "inSession", location: "dungeon", run: null }))).toBeNull();
    expect(runClockView(view({ phase: "connected", location: "dungeon", run: run() }))).toBeNull();
  });

  it("is neutral while decay is far off", () => {
    expect(runClockView(inRun({ elapsedMs: 65_000, decayStartsInMs: 300_000 }))).toEqual({
      elapsed: "1:05",
      countdown: "Decay in 5:00",
      stage: "neutral",
    });
  });

  it("turns amber from the warning window and rounds the countdown up", () => {
    expect(runClockView(inRun({ decayStartsInMs: RESISTANCE_DECAY_WARNING_MS + 1 }))?.stage).toBe("neutral");

    const warning = runClockView(inRun({ decayStartsInMs: RESISTANCE_DECAY_WARNING_MS }));
    expect(warning?.stage).toBe("warning");
    expect(runClockView(inRun({ decayStartsInMs: 29_100 }))?.countdown).toBe("Decay in 0:30");
  });

  it("turns red once resistance is falling", () => {
    expect(runClockView(inRun({ elapsedMs: 700_000, decayStartsInMs: 0, decaying: true }))).toEqual({
      elapsed: "11:40",
      countdown: "Resistance falling",
      stage: "decaying",
    });
  });
});

describe("hub status", () => {
  it("is null outside the hub", () => {
    expect(hubStatusView(view({ phase: "inSession", location: "dungeon" }))).toBeNull();
    expect(hubStatusView(view({ phase: "connected", location: "hub" }))).toBeNull();
  });

  it("is ready when everyone connected is ready", () => {
    const status = hubStatusView(
      view({ phase: "inSession", location: "hub", players: [player("Maya", { ready: true })] }),
    );
    expect(status?.ready).toBe(true);
    expect(status?.text).toBe("Party ready");
  });
});
