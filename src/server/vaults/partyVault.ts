import { z } from "zod";
import type { InventoryItem, RoomCode } from "../../shared/types/core.js";
import { inventoryItemSchema, roomCodeSchema } from "../../shared/types/core.js";

/**
 * The party vault: what every survivor of a room's runs carried out, shared by whoever is in that
 * room. It belongs to the room code rather than to a session or a profile, so a room reopened after
 * the session timed out, or after a restart, finds what it left, and a new room starts empty.
 *
 * It replaces the per-profile bank as where an escape deposits. Personal banks stay on the profile
 * as a read-only legacy list.
 */
export interface PartyVault {
  roomCode: RoomCode;
  items: InventoryItem[];
  /**
   * Runs this room has finished, by escape or wipe. The shop's rotating stock is derived from it
   * and the room code (decision 0014), so it lives with the vault and survives a restart.
   */
  runCount: number;
  /**
   * Bumped by `markVaultChanged` on every mutation, and compared against what was last written and
   * last sent. A counter for the same reason a profile has one: the code that deposits an item needs
   * no reference to whatever persists or broadcasts it.
   */
  revision: number;
}

/** Records that a vault changed, so the next flush writes it and the next tick sends it. */
export function markVaultChanged(vault: PartyVault): void {
  vault.revision += 1;
}

/** Records that a run ended, which rerolls the room's rotating shop stock. */
export function advanceRunCount(vault: PartyVault): void {
  vault.runCount += 1;
  markVaultChanged(vault);
}

/**
 * The on-disk shape, validated on read: a file a previous version or a person wrote is untrusted.
 * `revision` is absent for the reason it is absent from a profile.
 */
export const persistedVaultSchema = z.object({
  roomCode: roomCodeSchema,
  items: z.array(inventoryItemSchema),
  // Absent from vaults written before the shop existed, which start at their first rotation.
  runCount: z.number().int().nonnegative().default(0),
});

export const vaultFileSchema = z.object({
  version: z.literal(1),
  vaults: z.array(persistedVaultSchema),
});
export type VaultFile = z.infer<typeof vaultFileSchema>;

export const VAULT_FILE_VERSION = 1;
