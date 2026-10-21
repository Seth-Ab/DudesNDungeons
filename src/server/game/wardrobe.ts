import { roomAt } from "../../shared/game/rooms.js";
import type { ServerMessage } from "../../shared/protocol/index.js";
import type { CosmeticSlot, PlayerId } from "../../shared/types/core.js";
import type { GameContent } from "../content/loadContent.js";
import type { CosmeticDefinition } from "../content/schema.js";
import { markProfileChanged, type PlayerProfile } from "../profiles/profile.js";
import type { Session, SessionPlayer } from "../sessions/sessionStore.js";
import { isDown, isSpawned } from "./dungeonState.js";
import { contentForSession } from "./progression.js";
import { rotatingStock } from "./shop.js";

/**
 * Cosmetics (decision 0014, #128, #138): hats, cloaks, dyes, trails and flames a profile owns for
 * good and wears in the hub. They change how a player looks and nothing else, so nothing here
 * touches gameplay state.
 *
 * Ownership and what is worn live on the profile, never the session or the run, which is why a
 * death or a wipe cannot take them and a restart keeps them.
 */

/** How many priced items from the rotating pool the wardrobe stall stocks at once. */
export const COSMETIC_ROTATING_COUNT = 2;

/**
 * The ids the wardrobe stall sells right now: every priced, non-rotating cosmetic, plus this run
 * count's draw from the rotating pool. Drawn by the skill shop's helper, so it rerolls after every
 * run with the same room code and run count, and survives a restart the same way.
 */
export function cosmeticStock(content: GameContent, roomCode: string, runCount: number): Set<string> {
  const priced = [...content.cosmetics.values()].filter((cosmetic) => cosmetic.price !== undefined);
  const pool = priced
    .filter((cosmetic) => cosmetic.rotating)
    .map((cosmetic) => ({ itemId: cosmetic.id }));
  return new Set([
    ...priced.filter((cosmetic) => !cosmetic.rotating).map((cosmetic) => cosmetic.id),
    ...rotatingStock(pool, COSMETIC_ROTATING_COUNT, roomCode, runCount).map((entry) => entry.itemId),
  ]);
}

/** The whole catalogue as the wardrobe lists it, with what this room's stall has in stock. */
export function wardrobeCatalogMessage(session: Session): ServerMessage {
  const content = contentForSession(session);
  const stock = cosmeticStock(content, session.roomCode, session.vault.runCount);
  return {
    type: "wardrobeCatalog",
    entries: [...content.cosmetics.values()].map((cosmetic) => ({
      id: cosmetic.id,
      slot: cosmetic.slot,
      rarity: cosmetic.rarity,
      name: cosmetic.name,
      lore: cosmetic.lore,
      starter: cosmetic.starter,
      price: cosmetic.price ?? null,
      milestone: cosmetic.milestone ? { ...cosmetic.milestone } : null,
      rotating: cosmetic.rotating,
      inStock: stock.has(cosmetic.id),
    })),
  };
}

/** Whether a profile owns a cosmetic. A starter counts even if the profile somehow lacks it. */
export function ownsCosmetic(profile: PlayerProfile, cosmetic: CosmeticDefinition): boolean {
  return cosmetic.starter || profile.ownedCosmeticIds.includes(cosmetic.id);
}

/** Whether a player may buy from where they stand: in the hub, inside a room of kind `wardrobe`. */
export function inWardrobeArea(session: Session, player: SessionPlayer): boolean {
  if (session.location !== "hub") return false;
  return roomAt(session.dungeon.rooms, player.position)?.kind === "wardrobe";
}

export type CosmeticResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "notPermitted"
        | "outOfRange"
        | "unknownCosmetic"
        | "alreadyOwned"
        | "outOfStock"
        | "insufficientCoin"
        | "notOwned";
    };

/** A player who may change their profile's cosmetics at all: spawned, standing, and in the hub. */
function canUseWardrobe(session: Session, player: SessionPlayer | undefined): player is SessionPlayer {
  return player !== undefined && !isDown(player) && isSpawned(player) && session.location === "hub";
}

/**
 * Buys one cosmetic for the buyer's profile. The client names an id and never a price: the price
 * is read from content here. Every refusal returns before anything is touched, so a refused
 * purchase changes neither coin nor ownership. A bought item is owned, not worn.
 */
export function buyCosmetic(session: Session, playerId: PlayerId, cosmeticId: string): CosmeticResult {
  const player = session.players.get(playerId);
  if (!canUseWardrobe(session, player)) return { ok: false, reason: "notPermitted" };
  if (!inWardrobeArea(session, player)) return { ok: false, reason: "outOfRange" };

  const content = contentForSession(session);
  const cosmetic = content.cosmetics.get(cosmeticId);
  if (!cosmetic) return { ok: false, reason: "unknownCosmetic" };
  if (ownsCosmetic(player.profile, cosmetic)) return { ok: false, reason: "alreadyOwned" };

  const price = cosmetic.price;
  const stock = cosmeticStock(content, session.roomCode, session.vault.runCount);
  if (price === undefined || !stock.has(cosmetic.id)) return { ok: false, reason: "outOfStock" };
  if (player.profile.coin < price) return { ok: false, reason: "insufficientCoin" };

  player.profile.coin -= price;
  player.profile.ownedCosmeticIds.push(cosmetic.id);
  markProfileChanged(player.profile);
  return { ok: true };
}

/**
 * Wears an owned cosmetic in its slot, or takes the slot off when `cosmeticId` is null. Only in
 * the hub, but anywhere in it: the stall is where things are bought, not where they are worn.
 */
export function equipCosmetic(
  session: Session,
  playerId: PlayerId,
  slot: CosmeticSlot,
  cosmeticId: string | null,
): CosmeticResult {
  const player = session.players.get(playerId);
  if (!canUseWardrobe(session, player)) return { ok: false, reason: "notPermitted" };

  if (cosmeticId !== null) {
    const cosmetic = contentForSession(session).cosmetics.get(cosmeticId);
    if (!cosmetic || cosmetic.slot !== slot) return { ok: false, reason: "unknownCosmetic" };
    if (!ownsCosmetic(player.profile, cosmetic)) return { ok: false, reason: "notOwned" };
  }

  if (player.profile.equippedCosmetics[slot] !== cosmeticId) {
    player.profile.equippedCosmetics[slot] = cosmeticId;
    markProfileChanged(player.profile);
  }
  return { ok: true };
}

/**
 * Grants every cosmetic whose milestone the profile's stats have reached and that it does not
 * already own. Called with the skill milestones when a run's stats are credited, so a threshold
 * passed before the cosmetic shipped is met at the next extraction. Returns the ids granted now.
 */
export function grantCosmeticMilestones(player: SessionPlayer, content: GameContent): string[] {
  const { profile } = player;
  const granted: string[] = [];

  for (const cosmetic of content.cosmetics.values()) {
    if (!cosmetic.milestone || ownsCosmetic(profile, cosmetic)) continue;
    if (profile.stats[cosmetic.milestone.stat] < cosmetic.milestone.threshold) continue;
    profile.ownedCosmeticIds.push(cosmetic.id);
    granted.push(cosmetic.id);
  }

  if (granted.length > 0) markProfileChanged(profile);
  return granted;
}
