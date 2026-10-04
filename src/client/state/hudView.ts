import type { SessionView } from "../network/sessionState.js";
import {
  PLAYER_MAX_HEALTH,
  PLAYER_MAX_RESISTANCE,
  PLAYER_MAX_STAMINA,
  RESISTANCE_DECAY_WARNING_MS,
} from "../../shared/constants/game.js";
import type { InventoryItem, PlayerState, RunState } from "../../shared/types/core.js";
import {
  bankSummary,
  entranceMessage,
  entranceStatus,
  outcomeMessage,
  placeLabel,
  roomAt,
  torchNotice,
} from "./runFlow.js";

/**
 * What each HUD element shows for a given session view, kept free of the DOM so the node test
 * environment can drive it. `ui/hud/` only writes these results into elements.
 */

/** Item slots the hotbar and inventory list show. */
export const INVENTORY_SLOT_COUNT = 3;

const PHASE_LABELS: Record<SessionView["phase"], string> = {
  offline: "offline",
  connecting: "connecting",
  connected: "connected",
  joining: "joining",
  // Overridden once a snapshot says where the party is: since Backend step 10 a session starts in
  // the hub, so "in dungeon" was wrong for everyone who had not started a run yet.
  inSession: "in session",
  reconnecting: "reconnecting",
  failed: "connection lost",
};

export function connectionLabel(view: SessionView): string {
  if (view.phase === "inSession" && view.location) {
    return view.location === "hub" ? "in the hub" : "in a run";
  }
  return PHASE_LABELS[view.phase];
}

export function roomCodeLabel(view: SessionView): string {
  return view.roomCode ?? "-";
}

/**
 * `notImplemented` is the expected answer for actions the backend has not built yet, so it is not
 * something to alarm a player with.
 */
export function actionableError(view: SessionView): string {
  return view.lastError && view.lastError.code !== "notImplemented" ? view.lastError.message : "";
}

/**
 * Named from the room metadata the snapshot already carries, which is the only thing that tells the
 * Torch Supply apart from the Quest Gallery: the hub is one open rectangle.
 */
export function placeStatusLabel(view: SessionView, self: PlayerState | null): string {
  if (!view.dungeon) return "-";
  const room = self ? roomAt(view.dungeon.rooms, self.position) : null;
  return placeLabel(view.dungeon.map.name, room);
}

export function positionLabel(position: { x: number; y: number }): string {
  return `${position.x.toFixed(2)}, ${position.y.toFixed(2)}`;
}

export interface BarView {
  /** Fill fraction, clamped to 0..1. */
  ratio: number;
  text: string;
}

export function barView(current: number, max: number): BarView {
  const ratio = max > 0 ? Math.max(0, Math.min(1, current / max)) : 0;
  return { ratio, text: `${Math.round(current)}` };
}

export interface VitalsView {
  health: BarView;
  resistance: BarView;
  stamina: BarView;
}

export function vitalsView(self: PlayerState | null): VitalsView {
  return {
    health: barView(self?.health ?? 0, PLAYER_MAX_HEALTH),
    resistance: barView(self?.resistance ?? 0, PLAYER_MAX_RESISTANCE),
    stamina: barView(self?.stamina ?? 0, PLAYER_MAX_STAMINA),
  };
}

/**
 * What to say about resistance decay. Silent until the server says decay is close, so the warning
 * means something when it does appear.
 */
export function decayMessage(run: RunState | null): string {
  if (!run) return "";
  if (run.decaying) return "Resistance is falling. Get out of the dungeon.";
  if (run.decayStartsInMs > RESISTANCE_DECAY_WARNING_MS) return "";

  return `Resistance starts falling in ${Math.ceil(run.decayStartsInMs / 1000)}s.`;
}

export interface NoticesView {
  decay: string;
  gate: string;
  torch: string;
  outcome: string;
}

/** An empty string means the line is hidden. */
export function noticesView(view: SessionView, self: PlayerState | null): NoticesView {
  const inSession = view.phase === "inSession";
  const inHub = view.location === "hub";

  return {
    // Decay only runs in a dungeon, so the hub says what it is waiting for instead.
    decay: inSession && !inHub ? decayMessage(view.run) : "",
    gate: inSession && inHub ? entranceMessage(entranceStatus(view.players)) : "",
    torch: inSession ? torchNotice(self, view.location) : "",
    // Kept up while the party is back in the hub, so the last trip is still readable after the
    // action line has moved on to whatever they did next.
    outcome: inSession && inHub && view.runOutcome ? outcomeMessage(view.runOutcome) : "",
  };
}

export interface ControlsView {
  /** Ready and Leave only mean something once the session has started. */
  sessionControlsDisabled: boolean;
  actionsDisabled: boolean;
  carryLabel: string;
  useDisabled: boolean[];
}

export function controlsView(view: SessionView, self: PlayerState | null): ControlsView {
  const inSession = view.phase === "inSession";
  const canAct = inSession && (self?.health ?? 0) > 0;

  return {
    sessionControlsDisabled: !inSession,
    actionsDisabled: !canAct,
    carryLabel: self?.carryingPlayerId ? "Drop" : "Carry",
    useDisabled: Array.from({ length: INVENTORY_SLOT_COUNT }, (_, slot) => !canAct || !self?.inventory[slot]),
  };
}

export function readyLabel(ready: boolean): string {
  return ready ? "Ready ✓" : "Ready";
}

/**
 * The last thing the server said about an action, so a client-side message is not wiped by the next
 * snapshot 50ms later: `view.lastAction` keeps its value until another action happens. Returns the
 * text to show, or null when it has already been shown.
 */
export function newServerAction(view: SessionView, lastShown: string | null): string | null {
  return view.lastAction && view.lastAction !== lastShown ? view.lastAction : null;
}

export function inventorySlotLabels(items: readonly InventoryItem[]): string[] {
  return Array.from({ length: INVENTORY_SLOT_COUNT }, (_, slot) => items[slot]?.name ?? "-");
}

/**
 * Torches never enter the item slots, so nothing else would show one. A player who walks through
 * the gate without one spends the whole run in somebody else's light.
 */
export function torchStatusLabel(self: PlayerState | null): string {
  return self?.carryingTorch ? "carried" : "none";
}

export interface BankEntryView {
  text: string;
  empty: boolean;
}

/** What survived the last escape. Empty until somebody carries something out of a run. */
export function bankEntries(items: readonly InventoryItem[]): BankEntryView[] {
  const lines = bankSummary(items);
  if (lines.length === 0) return [{ text: "Nothing banked yet", empty: true }];
  return lines.map((text) => ({ text, empty: false }));
}

export interface RosterEntryView {
  text: string;
  offline: boolean;
  self: boolean;
}

export function rosterEntries(view: SessionView): RosterEntryView[] {
  return view.players.map((player) => {
    const standing =
      player.health > 0
        ? player.carryingPlayerId
          ? "carrying"
          : player.ready
            ? "ready"
            : "waiting"
        : player.carriedByPlayerId
          ? "down, being carried"
          : "down";
    const state = player.connected ? standing : "disconnected";

    return {
      text: `${player.name} · ${player.health}hp · ${state}`,
      offline: !player.connected,
      self: player.id === view.selfId,
    };
  });
}
