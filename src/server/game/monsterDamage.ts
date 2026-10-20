import type { MonsterState } from "../../shared/types/core.js";
import type { Session } from "../sessions/sessionStore.js";
import { refreshExitSeals } from "./bosses.js";
import { dropMonsterLoot } from "./monsterLoot.js";

/**
 * Applies one player hit to a monster and returns the health it actually lost. The only place a
 * monster's health goes down, so a sword and an arrow cannot disagree about what a kill does: the
 * last boss falling unseals the way out, and any death drops its loot.
 */
export function damageMonster(session: Session, monster: MonsterState, rawDamage: number): number {
  const dealt = Math.min(rawDamage, monster.health);
  monster.health -= dealt;
  monster.alive = monster.health > 0;
  if (monster.boss && !monster.alive) refreshExitSeals(session.dungeon);
  if (!monster.alive) dropMonsterLoot(session, monster);
  return dealt;
}
