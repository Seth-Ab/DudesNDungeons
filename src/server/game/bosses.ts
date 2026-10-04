import type { DungeonState } from "../../shared/types/core.js";

/**
 * Boss gating. A dungeon with a boss in it cannot be escaped until every boss there has fallen: the
 * exit stays sealed, and `interact` refuses it. The hub has no bosses, so its gate never seals.
 *
 * The seal is stored on each exit rather than derived when a snapshot is built, so the rule the
 * server enforces and the flag a client is shown are the same value. Anything that can defeat a
 * monster must call `refreshExitSeals` afterwards; today that is only a player's attack.
 */
export function bossesRemain(dungeon: DungeonState): boolean {
  return dungeon.monsters.some((monster) => monster.boss && monster.alive);
}

export function refreshExitSeals(dungeon: DungeonState): void {
  const sealed = bossesRemain(dungeon);
  for (const exit of dungeon.exits) exit.sealed = sealed;
}
