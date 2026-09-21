import { tileOf } from "../../shared/game/movement.js";
import type { RejectionReason } from "../../shared/protocol/index.js";
import type {
  InventoryItem,
  PlayerState,
  RoomState,
  SessionLocation,
  Vector2,
} from "../../shared/types/core.js";

/**
 * The wording and the derivations behind the hub and run flow, kept free of the DOM so the node
 * test environment can drive them. The server owns every decision here; this only says what the
 * decision was in a sentence a player can act on.
 */

/**
 * Whether the gate will open, and who the party is waiting on if it will not.
 *
 * Mirrors `partyReadyForRun` on the server: every reserved slot connected and ready, and a party of
 * nobody is not a party. Mirroring it is what lets the client refuse the interact itself rather
 * than send one the server will answer with a bare `notPermitted`, the same way `predictMove`
 * mirrors the movement rules. If the two ever drift the server still wins; the player just waits a
 * round trip to hear it.
 */
export type EntranceStatus = { kind: "ready" } | { kind: "waiting"; waitingOn: string[] };

export function entranceStatus(players: readonly PlayerState[]): EntranceStatus {
  if (players.length === 0) return { kind: "waiting", waitingOn: [] };

  const waitingOn = players
    .filter((player) => !player.connected || !player.ready)
    .map((player) => player.name);

  return waitingOn.length === 0 ? { kind: "ready" } : { kind: "waiting", waitingOn };
}

export function entranceMessage(status: EntranceStatus): string {
  if (status.kind === "ready") return "The party is ready. Use the Dungeon Gate to start the run.";
  if (status.waitingOn.length === 0) return "Waiting for the party to gather.";

  return `Waiting on ${nameList(status.waitingOn)} to ready up.`;
}

/**
 * The same thing in as few words as fit under the gate itself. Names belong in the HUD, where there
 * is room for them; the sign a player reads while walking up to the stairs only has to say whether
 * walking up to them is worth it.
 */
export function gatePrompt(players: readonly PlayerState[]): string {
  const status = entranceStatus(players);
  if (status.kind === "ready") return "The party is ready";
  if (players.length === 0) return "Waiting for the party";

  return `Waiting on ${status.waitingOn.length} of ${players.length}`;
}

/** "Maya", "Maya and Sam", "Maya, Sam and Iris". */
function nameList(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * How the run ended for the player being told.
 *
 * Derived from the snapshot either side of the return to the hub rather than announced by the
 * server, because nothing in protocol v8 announces it. That bounds what can honestly be said: a
 * party wipe and an escape that left this player behind are the same two snapshots from here, since
 * `returnToHub` heals everyone on the way back. So this speaks only about the player reading it,
 * which is true under both, and never about the party.
 */
export type RunOutcome = { kind: "escaped" | "lost"; banked: number };

export function runOutcome(before: PlayerState | null, after: PlayerState | null): RunOutcome {
  if (!before || !after) return { kind: "escaped", banked: 0 };
  if (before.health <= 0) return { kind: "lost", banked: 0 };

  const banked = Math.max(0, after.bankedItems.length - before.bankedItems.length);
  return { kind: "escaped", banked };
}

export function outcomeMessage(outcome: RunOutcome): string {
  if (outcome.kind === "lost") return "You went down. Everything you carried is gone.";
  if (outcome.banked === 0) return "You made it out, carrying nothing.";

  return `You made it out and banked ${countOf(outcome.banked, "item")}.`;
}

function countOf(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** The room a position stands in. Bounds are a top-left tile plus a size, inclusive of the walls. */
export function roomAt(rooms: readonly RoomState[], position: Vector2): RoomState | null {
  const tile = tileOf(position);

  return (
    rooms.find(
      (room) =>
        tile.x >= room.x &&
        tile.x < room.x + room.width &&
        tile.y >= room.y &&
        tile.y < room.y + room.height,
    ) ?? null
  );
}

/** Where the player is, named: the world, then the part of it they are standing in. */
export function placeLabel(mapName: string | null, room: RoomState | null): string {
  if (!mapName) return "-";
  return room ? `${mapName} · ${room.name}` : mapName;
}

/**
 * Banked items as lines to read, counted rather than repeated. The bank is session-local until
 * Backend step 11 persists a profile, which is worth a player knowing before they trust it.
 */
export function bankSummary(items: readonly InventoryItem[]): string[] {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.name, (counts.get(item.name) ?? 0) + 1);

  return [...counts].map(([name, count]) => (count === 1 ? name : `${name} x${count}`));
}

/**
 * The one thing a player can get wrong in the hub that the run will not forgive. A torch is not an
 * inventory item, so nothing else in the HUD would show its absence, and the gate does not check.
 */
export function torchNotice(self: PlayerState | null, location: SessionLocation | null): string {
  if (!self || location !== "hub" || self.carryingTorch) return "";
  return "No torch. Take one from the Torch Supply before you use the gate.";
}

/**
 * A refusal in words. `notPermitted` is deliberately vague: it answers a locked door without a key,
 * a tonic at full health, and a gate the party is not ready for alike, and the client cannot tell
 * which from the message. The cases worth a real sentence are pre-checked before they are sent, so
 * this is the fallback rather than the whole story.
 */
export function rejectionMessage(reason: RejectionReason): string {
  switch (reason) {
    case "blocked":
      return "Something is in the way.";
    case "outOfRange":
      return "Too far away.";
    case "onCooldown":
      return "Still recovering.";
    case "exhausted":
      return "Not enough stamina.";
    case "targetMissing":
      return "Nothing there to use.";
    case "notPermitted":
      return "You cannot do that here.";
  }
}
