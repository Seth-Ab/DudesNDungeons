import { randomUUID } from "node:crypto";
import { MAX_STACK_SIZE } from "../../shared/constants/game.js";
import { roomAt } from "../../shared/game/rooms.js";
import type { InventoryItem } from "../../shared/types/core.js";
import type { Session, SessionPlayer } from "../sessions/sessionStore.js";
import { markVaultChanged } from "../vaults/partyVault.js";
import { contentForSession } from "./progression.js";

/**
 * Whether a player may use the party vault from where they stand: in the hub, inside a room of kind
 * `vault`. The room is the vault area the Bank stall stands in, and the client prompts by the same
 * shared `roomAt` rule.
 */
export function inVaultArea(session: Session, player: SessionPlayer): boolean {
  if (session.location !== "hub") return false;
  return roomAt(session.dungeon.rooms, player.position)?.kind === "vault";
}

/**
 * The largest a vault stack of this ammo may grow. Content's `maxStack` where the definition still
 * exists, otherwise the protocol's cap, so an item whose content was removed is kept rather than
 * refused. Capacity is otherwise unlimited.
 */
function vaultStackLimit(session: Session, itemId: string): number {
  const definition = contentForSession(session).items.get(itemId);
  return definition?.kind === "ammo" ? definition.maxStack : MAX_STACK_SIZE;
}

/**
 * Puts an item in the party vault. Ammo merges into the vault's stacks of the same item until they
 * are full, and only what is left over becomes an entry of its own, so ten trips' worth of arrows
 * read as one or two stacks rather than ten. Anything else is stored as it is, keeping its id.
 */
export function storeInVault(session: Session, item: InventoryItem): void {
  const vault = session.vault;
  if (item.kind !== "ammo") {
    vault.items.push({ ...item });
    markVaultChanged(vault);
    return;
  }

  const limit = vaultStackLimit(session, item.itemId);
  let left = item.count;
  for (const stack of vault.items) {
    if (left === 0) break;
    if (stack.kind !== "ammo" || stack.itemId !== item.itemId) continue;
    const added = Math.min(left, Math.max(0, limit - stack.count));
    stack.count += added;
    left -= added;
  }
  // A stored stack keeps the item's id when it is the first piece split off, so a deposit and the
  // vault entry it became stay traceable. Any further overflow takes fresh ids.
  let keepId = !vault.items.some((entry) => entry.id === item.id);
  while (left > 0) {
    const count = Math.min(left, limit);
    vault.items.push({ ...item, id: keepId ? item.id : randomUUID(), count });
    left -= count;
    keepId = false;
  }
  markVaultChanged(vault);
}
