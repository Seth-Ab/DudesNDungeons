import type { MonsterState } from "../../shared/types/core.js";
import type { Session } from "../sessions/sessionStore.js";
import { EMBER_WARDEN_MONSTER_ID } from "../../shared/constants/game.js";
import { refreshExitSeals } from "./bosses.js";
import { recordEmberWardenKill } from "./milestones.js";
import { dropMonsterLoot } from "./monsterLoot.js";

/**
 * Applies one player hit to a monster and returns the health it actually lost. The only place a
 * monster's health goes down, so a sword and an arrow cannot disagree about what a kill does: the
 * last boss falling unseals the way out, any death drops its loot, and the Ember Warden's counts
 * toward milestone stats.
 */
export function damageMonster(session: Session, monster: MonsterState, rawDamage: number): number {
  const dealt = Math.min(rawDamage, monster.health);
  monster.health -= dealt;
  monster.alive = monster.health > 0;
  if (monster.boss && !monster.alive) refreshExitSeals(session.dungeon);
  if (!monster.alive) dropMonsterLoot(session, monster);
  if (!monster.alive && monster.typeId === EMBER_WARDEN_MONSTER_ID) recordEmberWardenKill(session);
  return dealt;
}
