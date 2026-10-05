import type { SessionView } from "../network/sessionState.js";
import {
  PLAYER_MAX_HEALTH,
  PLAYER_MAX_RESISTANCE,
  PLAYER_MAX_STAMINA,
  RESISTANCE_DECAY_WARNING_MS,
} from "../../shared/constants/game.js";
import type { InventoryItem, PlayerState, RunState, Vector2 } from "../../shared/types/core.js";
import {
  bankSummary,
  entranceMessage,
  entranceStatus,
  outcomeMessage,
  placeLabel,
  roomAt,
  torchNotice,
} from "./runFlow.js";
import { keyLabel, USE_SLOT_ACTIONS, type GameplayAction } from "../input/keyBindings.js";
import { LOOT_SPRITES, type SpriteName } from "../rendering/tiles.js";
import { carriedAlly, nearestDownedAlly, nearestInteraction, nearestLoot } from "./reach.js";
import type { ToastSeverity } from "./toastQueue.js";

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

/** Health below this fraction (while still alive) puts the bar in its pulsing warning state. */
export const LOW_HEALTH_RATIO = 0.25;

export interface HealthBarView extends BarView {
  low: boolean;
}

export interface ResistanceBarView extends BarView {
  /** Resistance is draining on the server's run clock. */
  decaying: boolean;
}

export interface VitalsView {
  health: HealthBarView;
  resistance: ResistanceBarView;
  stamina: BarView;
}

/** Label glyphs, so the three bars differ by more than hue. */
export const VITAL_GLYPHS = { health: "♥", resistance: "◆", stamina: "»", decaying: "▼" } as const;

/** Health reads as `current/max`; resistance is a modifier, so it keeps the bare number. */
export function healthBarView(current: number, max: number): HealthBarView {
  const bar = barView(current, max);
  return {
    ratio: bar.ratio,
    text: `${Math.round(Math.max(0, current))}/${Math.round(max)}`,
    low: current > 0 && bar.ratio < LOW_HEALTH_RATIO,
  };
}

export function vitalsView(self: PlayerState | null, run: RunState | null = null): VitalsView {
  const resistance = barView(self?.resistance ?? 0, PLAYER_MAX_RESISTANCE);
  return {
    health: healthBarView(self?.health ?? 0, PLAYER_MAX_HEALTH),
    resistance: { ...resistance, decaying: self !== null && run?.decaying === true && resistance.ratio > 0 },
    // No number: stamina is felt in the moment, not read.
    stamina: { ...barView(self?.stamina ?? 0, PLAYER_MAX_STAMINA), text: "" },
  };
}

export type VitalChange = "damage" | "heal" | null;

/**
 * What changed between two consecutive snapshots of the local player's health, for the flash.
 * `previous` is null on the first snapshot and after the player disappears, so joining or
 * respawning is not reported as a heal.
 */
export function vitalChange(previous: number | null, current: number | null): VitalChange {
  if (previous === null || current === null) return null;
  if (current < previous) return "damage";
  if (current > previous) return "heal";
  return null;
}

/** True when the server has refused another action for lack of stamina since `previous`. */
export function staminaRefused(previous: number, current: number): boolean {
  return current > previous;
}

/**
 * What to say about resistance decay before it starts. Silent until the server says decay is close, so the warning
 * means something when it does appear.
 */
export function decayMessage(run: RunState | null): string {
  if (!run) return "";
  // While it is falling the resistance bar says so; a toast on top would only repeat it.
  if (run.decaying) return "";
  if (run.decayStartsInMs > RESISTANCE_DECAY_WARNING_MS) return "";

  return `Resistance starts falling in ${Math.ceil(run.decayStartsInMs / 1000)}s.`;
}

/** "0:07", "12:03", "1:02:03": whole seconds, rounded down. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const pad = (value: number): string => `${value}`.padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** Neutral until the final warning window, amber inside it, red once resistance is falling. */
export type RunClockStage = "neutral" | "warning" | "decaying";

export interface RunClockView {
  elapsed: string;
  /** What the second line says: the time left before decay, or that it has begun. */
  countdown: string;
  stage: RunClockStage;
}

/**
 * The persistent run clock, from the server's own `RunState`. Null in the hub, before the first
 * snapshot, and outside a session, so the HUD hides it rather than showing a stale clock.
 */
export function runClockView(view: SessionView): RunClockView | null {
  if (view.phase !== "inSession" || view.location !== "dungeon" || !view.run) return null;

  const { elapsedMs, decayStartsInMs, decaying } = view.run;
  if (decaying) {
    return { elapsed: formatClock(elapsedMs), countdown: "Resistance falling", stage: "decaying" };
  }

  return {
    elapsed: formatClock(elapsedMs),
    countdown: `Decay in ${formatClock(Math.ceil(decayStartsInMs / 1000) * 1000)}`,
    stage: decayStartsInMs <= RESISTANCE_DECAY_WARNING_MS ? "warning" : "neutral",
  };
}

export interface HubStatusView {
  ready: boolean;
  /** The headline: whether walking up to the gate is worth it. */
  text: string;
  /** Who it is waiting on, or how to start. */
  detail: string;
}

/**
 * The persistent hub gate status. Null outside the hub, where there is no gate to wait at.
 * Replaces the gate toast, which expired while the party was still waiting.
 */
export function hubStatusView(view: SessionView): HubStatusView | null {
  if (view.phase !== "inSession" || view.location !== "hub") return null;

  const status = entranceStatus(view.players);
  const detail = entranceMessage(status);
  if (status.kind === "ready") return { ready: true, text: "Party ready", detail };
  return { ready: false, text: "Waiting on the party", detail };
}

export interface NoticesView {
  decay: string;
  torch: string;
  outcome: string;
}

/** An empty string means the line is hidden. */
export function noticesView(view: SessionView, self: PlayerState | null): NoticesView {
  const inSession = view.phase === "inSession";
  const inHub = view.location === "hub";

  return {
    decay: inSession && !inHub ? decayMessage(view.run) : "",
    torch: inSession ? torchNotice(self, view.location) : "",
    // Kept up while the party is back in the hub, so the last trip is still readable after the
    // action line has moved on to whatever they did next.
    outcome: inSession && inHub && view.runOutcome ? outcomeMessage(view.runOutcome) : "",
  };
}

export interface ToastMessage {
  key: string;
  text: string;
  severity: ToastSeverity;
  /** Overrides the severity's default lifetime. */
  ttlMs?: number;
}

/** What the outcome banner showed, kept up longer than a warning: it is the last trip's result. */
const OUTCOME_TOAST_TTL_MS = 12000;

/**
 * Every transient message source, in display order, with its current text. An empty text means the
 * source has nothing to say, which is how the toast queue knows to forget it.
 */
export function toastMessages(view: SessionView, self: PlayerState | null): ToastMessage[] {
  const notices = noticesView(view, self);

  return [
    { key: "error", text: actionableError(view), severity: "error" },
    { key: "decay", text: notices.decay, severity: "warning" },
    { key: "torch", text: notices.torch, severity: "warning" },
    { key: "outcome", text: notices.outcome, severity: "info", ttlMs: OUTCOME_TOAST_TTL_MS },
  ];
}

export interface ControlsView {
  /** Ready and Leave only mean something once the session has started. */
  sessionControlsDisabled: boolean;
  actionsDisabled: boolean;
}

export function controlsView(view: SessionView, self: PlayerState | null): ControlsView {
  const inSession = view.phase === "inSession";
  const canAct = inSession && (self?.health ?? 0) > 0;

  return {
    sessionControlsDisabled: !inSession,
    actionsDisabled: !canAct,
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

export type PartyMemberState = "ready" | "waiting" | "carrying" | "downed" | "beingCarried" | "disconnected";

/** One glyph per state, so the states differ by shape and not only by hue. */
export const PARTY_STATE_ICONS: Record<PartyMemberState, string> = {
  ready: "✓",
  waiting: "○",
  carrying: "↑",
  downed: "✖",
  beingCarried: "↓",
  disconnected: "⊘",
};

export const PARTY_STATE_LABELS: Record<PartyMemberState, string> = {
  ready: "ready",
  waiting: "waiting",
  carrying: "carrying an ally",
  downed: "downed",
  beingCarried: "downed, being carried",
  disconnected: "disconnected",
};

export interface PartyFrameView {
  id: string;
  name: string;
  state: PartyMemberState;
  icon: string;
  stateLabel: string;
  health: HealthBarView;
  resistance: BarView;
}

export function partyMemberState(player: PlayerState): PartyMemberState {
  if (!player.connected) return "disconnected";
  if (player.health <= 0) return player.carriedByPlayerId ? "beingCarried" : "downed";
  if (player.carryingPlayerId) return "carrying";
  return player.ready ? "ready" : "waiting";
}

/**
 * One frame per other player in the latest snapshot. The server only lists players on tiles this
 * player can see, so an ally who leaves sight is simply absent from the next snapshot and loses
 * their frame; nothing here remembers last-known state. Self is left out: the vitals cluster
 * already covers it.
 */
export function partyFrames(view: SessionView): PartyFrameView[] {
  return view.players
    .filter((player) => player.id !== view.selfId)
    .map((player) => {
      const state = partyMemberState(player);
      return {
        id: player.id,
        name: player.name,
        state,
        icon: PARTY_STATE_ICONS[state],
        stateLabel: PARTY_STATE_LABELS[state],
        health: healthBarView(player.health, PLAYER_MAX_HEALTH),
        resistance: barView(player.resistance, PLAYER_MAX_RESISTANCE),
      };
    });
}

export interface HotbarSlotView {
  /** The key hint printed in the slot, from the shared key-binding table. */
  keyHint: string;
  action: GameplayAction;
  empty: boolean;
  name: string;
  icon: SpriteName | null;
  disabled: boolean;
}

/** Three slots, always: an empty one is drawn as such so the bar does not change shape. */
export function hotbarView(view: SessionView, self: PlayerState | null): HotbarSlotView[] {
  const canAct = view.phase === "inSession" && (self?.health ?? 0) > 0;

  return Array.from({ length: INVENTORY_SLOT_COUNT }, (_, slot) => {
    const item = self?.inventory[slot];
    const action = USE_SLOT_ACTIONS[slot] as GameplayAction;
    return {
      keyHint: keyLabel(action),
      action,
      empty: !item,
      name: item?.name ?? "Empty",
      icon: item ? LOOT_SPRITES[item.kind] : null,
      disabled: !canAct || !item,
    };
  });
}

export interface ActionPromptView {
  action: GameplayAction;
  keyHint: string;
  text: string;
}

/**
 * The single most relevant thing in reach, or null when nothing is. Derived from the snapshot and
 * the local position only; the server still decides, and a wrong guess comes back as
 * `actionRejected`. Priority: dropping a carried ally, lifting a downed one, loot, then doors and
 * exits.
 */
export function actionPrompt(
  view: SessionView,
  self: PlayerState | null,
  position: Vector2,
): ActionPromptView | null {
  if (view.phase !== "inSession" || !view.dungeon || !self || self.health <= 0) return null;

  const prompt = (action: GameplayAction, text: string): ActionPromptView => ({
    action,
    keyHint: keyLabel(action),
    text,
  });

  const carried = carriedAlly(view, self);
  if (carried) return prompt("carry", `Drop ${carried.name}`);

  const downed = nearestDownedAlly(view, position);
  if (downed) return prompt("carry", `Lift ${downed.name}`);

  const loot = nearestLoot(view, position);
  if (loot) return prompt("pickup", `Pick up ${loot.name}`);

  const target = nearestInteraction(view, position);
  if (target?.kind === "door") return prompt("interact", "Open door");
  if (target?.kind === "exit") {
    return prompt("interact", view.location === "hub" ? "Enter the dungeon" : "Leave the dungeon");
  }

  return null;
}
