import { z } from "zod";
import type {
  InventoryItem,
  PlayerName,
  ProfileId,
  ProfileState,
} from "../../shared/types/core.js";
import { contentIdSchema, inventoryItemSchema } from "../../shared/types/core.js";

/**
 * A roguelite profile: what a device keeps between runs, and between server restarts.
 *
 * Per `GAMEDESCRIPTION.md`, progression is items and skills a player keeps, losing only items on
 * death. There is deliberately no currency here: the description names none, and the upgrade
 * schema in `src/server/content/schema.ts` leaves unlock costs out for the same reason.
 *
 * `secretHash` rather than the secret itself, so a leaked `profiles.json` does not hand over every
 * profile on the server. It is also why a client that loses its secret cannot be reminded of it.
 */
export interface PlayerProfile {
  id: ProfileId;
  secretHash: string;
  /** The name last joined with. Presentation only; the secret is what identifies the profile. */
  displayName: PlayerName;
  bankedItems: InventoryItem[];
  unlockedSkillIds: string[];
  unlockedUpgradeIds: string[];
  runsEscaped: number;
  runsLost: number;
  createdAt: number;
  lastSeenAt: number;
  /**
   * Bumped by `markProfileChanged` on every mutation, and compared against what was last written.
   *
   * A counter rather than a dirty flag on the store, so the code that mutates a profile needs no
   * reference to whatever is persisting it: `returnToHub` banks items without knowing a file
   * exists.
   */
  revision: number;
}

/**
 * Records that a profile changed, so the next flush writes it. Call after every mutation.
 *
 * Deliberately clockless. Game code that banks an item is paced by `performance.now()`, which is
 * monotonic rather than wall time, and stamping that onto a profile would write a number that means
 * nothing across a restart. `lastSeenAt` is set on join instead, where a real clock is at hand.
 */
export function markProfileChanged(profile: PlayerProfile): void {
  profile.revision += 1;
}

/** The owner's view of their own profile. Drops `secretHash` and the persistence bookkeeping. */
export function toProfileState(profile: PlayerProfile): ProfileState {
  return {
    id: profile.id,
    displayName: profile.displayName,
    bankedItems: profile.bankedItems.map((item) => ({ ...item })),
    unlockedSkillIds: [...profile.unlockedSkillIds],
    unlockedUpgradeIds: [...profile.unlockedUpgradeIds],
    runsEscaped: profile.runsEscaped,
    runsLost: profile.runsLost,
  };
}

/**
 * Banked items written before consumables were content-driven carry the kind `tonic` or `ward`
 * and nothing else. They are rewritten on read as the consumables those kinds always meant, so a
 * profile survives the change without a separate migration step. The next write persists the new
 * shape. Descriptions repeat the shipped content because a profile is parsed without it.
 */
const LEGACY_CONSUMABLES = new Map([
  ["tonic", { itemId: "minor-tonic", description: "Restores 35 health.", icon: "tonic" }],
  ["ward", { itemId: "warding-salve", description: "Restores 25 resistance.", icon: "ward" }],
]);

function migrateLegacyItem(value: unknown): unknown {
  if (typeof value !== "object" || value === null || !("kind" in value)) return value;
  const legacy = typeof value.kind === "string" ? LEGACY_CONSUMABLES.get(value.kind) : undefined;
  return legacy ? { ...value, ...legacy, kind: "consumable" } : value;
}

/**
 * The on-disk shape, validated on read for the same reason `content/` is: a file a human or a
 * previous version wrote is untrusted input, and a profile that parses into nonsense is worse than
 * one that fails loudly.
 *
 * `revision` is deliberately absent. It tracks what this process has yet to write, so a freshly
 * loaded profile starts at zero and is written again only once something changes it.
 */
export const persistedProfileSchema = z.object({
  id: z.string().uuid(),
  secretHash: z.string().regex(/^[0-9a-f]{64}$/, "Profile secret hash must be 64 lowercase hex"),
  displayName: z.string().min(1),
  bankedItems: z.array(z.preprocess(migrateLegacyItem, inventoryItemSchema)),
  unlockedSkillIds: z.array(contentIdSchema),
  unlockedUpgradeIds: z.array(contentIdSchema),
  runsEscaped: z.number().int().nonnegative(),
  runsLost: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
  lastSeenAt: z.number().int().nonnegative(),
});

/**
 * `version` is what makes a later format change survivable: a reader that finds a version it does
 * not know refuses rather than discarding fields it cannot see.
 */
export const profileFileSchema = z.object({
  version: z.literal(1),
  profiles: z.array(persistedProfileSchema),
});
export type ProfileFile = z.infer<typeof profileFileSchema>;

export const PROFILE_FILE_VERSION = 1;
