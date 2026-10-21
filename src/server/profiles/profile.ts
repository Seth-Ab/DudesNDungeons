import { z } from "zod";
import type {
  InventoryItem,
  PlayerName,
  ProfileId,
  ProfileState,
} from "../../shared/types/core.js";
import { inventoryItemSchema, skillStacksSchema } from "../../shared/types/core.js";

/**
 * A roguelite profile: what a device keeps between runs, and between server restarts.
 *
 * Per `GAMEDESCRIPTION.md`, progression is items and skills a player keeps, losing only items on
 * death. Skills are held as stack counts and coin is the progression currency (decision 0014);
 * milestone stats arrive with their own follow-up ticket.
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
  /**
   * Permanent stacks per skill id, each at least 1. Kept even for a skill content no longer has,
   * or above a lowered limit, so a content change never deletes what a player earned.
   */
  skillStacks: Record<string, number>;
  /** Banked coin. Credited on extraction or a hub conversion, only through `markProfileChanged`. */
  coin: number;
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
    skillStacks: { ...profile.skillStacks },
    coin: profile.coin,
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
 * The tiered upgrades that decision 0014 folded into skill stacks: which skill each raised, and to
 * what tier. Repeated here, like the legacy consumables, because a profile is parsed without
 * content, and these ids no longer exist in it.
 */
const LEGACY_UPGRADES = new Map([
  ["iron-will-steeled", { skillId: "iron-will", tier: 1 }],
  ["iron-will-unbroken", { skillId: "iron-will", tier: 2 }],
]);

/**
 * Profiles written before skills stacked hold `unlockedSkillIds` and `unlockedUpgradeIds`. Each
 * skill id becomes one stack, and each upgrade id raises its skill to one plus its tier, so
 * nothing a player unlocked is lost. An upgrade id this list does not know is dropped: no content
 * ever shipped it, so it never had an effect. The next write persists the new shape.
 */
function migrateLegacySkills(value: unknown): unknown {
  if (typeof value !== "object" || value === null || "skillStacks" in value) return value;
  const { unlockedSkillIds, unlockedUpgradeIds, ...rest } = value as Record<string, unknown>;
  const skillStacks: Record<string, number> = {};

  if (Array.isArray(unlockedSkillIds)) {
    for (const skillId of unlockedSkillIds) {
      if (typeof skillId === "string") skillStacks[skillId] = 1;
    }
  }
  if (Array.isArray(unlockedUpgradeIds)) {
    for (const upgradeId of unlockedUpgradeIds) {
      const upgrade = typeof upgradeId === "string" ? LEGACY_UPGRADES.get(upgradeId) : undefined;
      if (!upgrade) continue;
      skillStacks[upgrade.skillId] = Math.max(skillStacks[upgrade.skillId] ?? 0, upgrade.tier + 1);
    }
  }

  return { ...rest, skillStacks };
}

/**
 * The on-disk shape, validated on read for the same reason `content/` is: a file a human or a
 * previous version wrote is untrusted input, and a profile that parses into nonsense is worse than
 * one that fails loudly.
 *
 * `revision` is deliberately absent. It tracks what this process has yet to write, so a freshly
 * loaded profile starts at zero and is written again only once something changes it.
 */
export const persistedProfileSchema = z.preprocess(
  migrateLegacySkills,
  z.object({
    id: z.string().uuid(),
    secretHash: z.string().regex(/^[0-9a-f]{64}$/, "Profile secret hash must be 64 lowercase hex"),
    displayName: z.string().min(1),
    bankedItems: z.array(z.preprocess(migrateLegacyItem, inventoryItemSchema)),
    skillStacks: skillStacksSchema,
    // Absent from profiles written before coin existed, which start with none.
    coin: z.number().int().nonnegative().default(0),
    runsEscaped: z.number().int().nonnegative(),
    runsLost: z.number().int().nonnegative(),
    createdAt: z.number().int().nonnegative(),
    lastSeenAt: z.number().int().nonnegative(),
  }),
);

/**
 * `version` is what makes a later format change survivable: a reader that finds a version it does
 * not know refuses rather than discarding fields it cannot see. Version 2 stores skill stacks;
 * version 1 files are still read, and migrated per profile, but only version 2 is written.
 */
export const profileFileSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]),
  profiles: z.array(persistedProfileSchema),
});
export type ProfileFile = z.infer<typeof profileFileSchema>;

export const PROFILE_FILE_VERSION = 2;
