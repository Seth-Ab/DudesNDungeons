import { roomAt } from "../../shared/game/rooms.js";
import type { RejectionReason } from "../../shared/protocol/index.js";
import type {
  ExitState,
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

/**
 * What the sign over an exit says. A sealed exit is the server refusing the escape while a boss
 * lives, so it is named before the party walks up to it rather than after a bare `notPermitted`.
 * It says nothing about where the boss is: the client only learns that from seeing it.
 */
export function exitCaption(location: SessionLocation | null, exit: ExitState): string {
  if (location === "hub") return "Dungeon Gate";
  return exit.sealed ? "Way Out (Sealed)" : "Way Out";
}

export const SEALED_EXIT_PROMPT = "Defeat the boss to escape";

/** The interact refusal for a sealed exit, answered locally like an unready party at the gate. */
export const SEALED_EXIT_MESSAGE = "The way out is sealed. Defeat the boss to escape.";

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
 *
 * A survivor deposits everything they carried into the party vault, so `deposited` is the carry in
 * the last dungeon snapshot: inventory entries plus the hand. A downed player who was being carried
 * out counts as a survivor, exactly as the server counts them.
 */
export type RunOutcome = { kind: "escaped" | "lost"; deposited: number };

export function runOutcome(before: PlayerState | null, after: PlayerState | null): RunOutcome {
  if (!before || !after) return { kind: "escaped", deposited: 0 };
  if (before.health <= 0 && before.carriedByPlayerId === null) return { kind: "lost", deposited: 0 };

  return { kind: "escaped", deposited: before.inventory.length + (before.held ? 1 : 0) };
}

export function outcomeMessage(outcome: RunOutcome): string {
  if (outcome.kind === "lost") return "You went down. Everything you carried is gone.";
  if (outcome.deposited === 0) return "You made it out, carrying nothing.";

  return `You made it out and deposited ${countOf(outcome.deposited, "item")} to the vault.`;
}

/** The action prompt inside the vault area, where interacting opens the shared vault. */
export const VAULT_PROMPT = "Open the party vault";

/**
 * Whether this position can use the party vault: in the hub, inside a `vault` room. The same rule
 * the server judges `withdrawVaultItem` and `depositVaultItem` by, from the same shared `roomAt`.
 */
export function inVaultArea(
  location: SessionLocation | null,
  rooms: readonly RoomState[],
  position: Vector2,
): boolean {
  return location === "hub" && roomAt(rooms, position)?.kind === "vault";
}

/** The action prompt inside the wardrobe area, where interacting opens the wardrobe. */
export const WARDROBE_PROMPT = "Browse the wardrobe";

/**
 * Whether this position can buy at the wardrobe stall: in the hub, inside a `wardrobe` room. The
 * same rule the server judges `buyCosmetic` by. Equipping works anywhere in the hub.
 */
export function inWardrobeArea(
  location: SessionLocation | null,
  rooms: readonly RoomState[],
  position: Vector2,
): boolean {
  return location === "hub" && roomAt(rooms, position)?.kind === "wardrobe";
}

/** The action prompt inside the shop area, where interacting opens the scroll shop. */
export const SHOP_PROMPT = "Browse the scroll shop";

/**
 * Whether this position can use the skill shop: in the hub, inside a `shop` room. The same rule the
 * server judges `buySkillScroll` by, from the same shared `roomAt`.
 */
export function inShopArea(
  location: SessionLocation | null,
  rooms: readonly RoomState[],
  position: Vector2,
): boolean {
  return location === "hub" && roomAt(rooms, position)?.kind === "shop";
}

function countOf(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

export { roomAt };

/** Where the player is, named: the world, then the part of it they are standing in. */
export function placeLabel(mapName: string | null, room: RoomState | null): string {
  if (!mapName) return "-";
  return room ? `${mapName} · ${room.name}` : mapName;
}

/**
 * Banked items as lines to read, counted rather than repeated. A stack counts as its size, so two
 * banked stacks of arrows read as one total. Only the legacy personal bank reads this way: the
 * vault lists entries one by one, because each has its own Take button.
 */
export function bankSummary(items: readonly InventoryItem[]): string[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const size = item.kind === "ammo" ? item.count : 1;
    counts.set(item.name, (counts.get(item.name) ?? 0) + size);
  }

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
    case "skillMaxed":
      return "You already know that skill as well as it can be known.";
    case "missingPrerequisites":
      return "You need another skill before you can learn this one.";
    case "outOfStock":
      return "That scroll is not in stock.";
    case "insufficientCoin":
      return "Not enough coin.";
    case "inventoryFull":
      return "Your pack is full.";
    case "unknownCosmetic":
      return "The wardrobe has no such thing.";
    case "alreadyOwned":
      return "You already own that.";
    case "notOwned":
      return "You do not own that yet.";
    case "inCombat":
      return "Not while you are in a fight.";
  }
}

/** A wardrobe refusal in words. The shared ones name scrolls, which a cosmetic is not. */
export function wardrobeRejectionMessage(reason: RejectionReason): string {
  if (reason === "outOfStock") return "The stall is not selling that right now.";
  if (reason === "outOfRange") return "Buy at the Wardrobe stall.";
  return rejectionMessage(reason);
}
