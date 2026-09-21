import {
  PLAYER_MAX_RESISTANCE,
  PLAYER_TORCH_LIGHT_RADIUS,
} from "../../shared/constants/game.js";
import { gameContent, type GameContent } from "../content/loadContent.js";
import type { ProgressionEffect } from "../content/schema.js";
import { markProfileChanged } from "../profiles/profile.js";
import type { Session, SessionPlayer } from "../sessions/sessionStore.js";

export type ProgressionEffectType = ProgressionEffect["type"];

/** The immutable catalog used to build this session's worlds and resolve its progression. */
export function contentForSession(session: Session): GameContent {
  return session.runDungeon.content ?? gameContent();
}

/** Permanent profile skills plus scrolls learned during the current run. */
export function activeSkillIds(player: SessionPlayer): Set<string> {
  return new Set([...player.profile.unlockedSkillIds, ...player.runSkillIds]);
}

/**
 * Adds one supported effect across active skills and valid permanent upgrades.
 *
 * Profiles are durable and content can change between releases, so an id that no longer exists is
 * ignored rather than crashing a live session. An upgrade contributes only while its owning skill
 * and every prerequisite are active on that profile.
 */
export function progressionEffectTotal(
  player: SessionPlayer,
  type: ProgressionEffectType,
  content: GameContent = gameContent(),
): number {
  const skills = activeSkillIds(player);
  const unlockedUpgrades = new Set(player.profile.unlockedUpgradeIds);
  let total = 0;

  for (const skillId of skills) {
    const skill = content.skills.get(skillId);
    if (!skill) continue;
    for (const effect of skill.effects) {
      if (effect.type === type) total += effect.amount;
    }
  }

  for (const upgradeId of unlockedUpgrades) {
    const upgrade = content.upgrades.get(upgradeId);
    if (
      !upgrade ||
      !skills.has(upgrade.skillId) ||
      upgrade.requires.some((required) => !unlockedUpgrades.has(required))
    ) {
      continue;
    }
    for (const effect of upgrade.effects) {
      if (effect.type === type) total += effect.amount;
    }
  }

  return total;
}

/** Resistance as gameplay and the HUD see it, including active skill effects. */
export function effectiveResistance(
  player: SessionPlayer,
  content: GameContent = gameContent(),
): number {
  return Math.min(
    PLAYER_MAX_RESISTANCE,
    Math.max(0, player.resistance + progressionEffectTotal(player, "resistanceBonus", content)),
  );
}

/** Personal torch reach after active skill effects. */
export function torchLightRadiusFor(
  player: SessionPlayer,
  content: GameContent = gameContent(),
): number {
  return PLAYER_TORCH_LIGHT_RADIUS + progressionEffectTotal(player, "sightRadiusBonus", content);
}

/**
 * Learns a scroll. Dungeon learning is provisional; hub learning is permanent immediately because
 * the hub is the save boundary. Returns false for an unknown or already-known skill.
 */
export function learnSkill(session: Session, player: SessionPlayer, skillId: string): boolean {
  const content = contentForSession(session);
  if (!content.skills.has(skillId)) return false;
  if (player.profile.unlockedSkillIds.includes(skillId) || player.runSkillIds.has(skillId)) {
    return false;
  }

  if (session.location === "hub") {
    player.profile.unlockedSkillIds.push(skillId);
    markProfileChanged(player.profile);
  } else {
    player.runSkillIds.add(skillId);
  }
  return true;
}

/** Saves provisional run skills for a player who made it out. */
export function bankRunSkills(player: SessionPlayer): void {
  const known = new Set(player.profile.unlockedSkillIds);
  for (const skillId of player.runSkillIds) {
    if (known.has(skillId)) continue;
    player.profile.unlockedSkillIds.push(skillId);
    known.add(skillId);
  }
  player.runSkillIds.clear();
}

/** Drops every provisional unlock when a player does not make it out. */
export function discardRunSkills(player: SessionPlayer): void {
  player.runSkillIds.clear();
}
