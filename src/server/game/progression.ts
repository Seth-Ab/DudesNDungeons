import {
  PLAYER_MAX_RESISTANCE,
  PLAYER_TORCH_LIGHT_RADIUS,
} from "../../shared/constants/game.js";
import type { ServerMessage } from "../../shared/protocol/index.js";
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
  let total = 0;

  for (const skillId of activeSkillIds(player)) {
    const skill = content.skills.get(skillId);
    if (!skill) continue;
    for (const effect of skill.effects) {
      if (effect.type === type) total += effect.amount;
    }
  }

  for (const upgradeId of activeUpgradeIds(player, content)) {
    for (const effect of content.upgrades.get(upgradeId)?.effects ?? []) {
      if (effect.type === type) total += effect.amount;
    }
  }

  return total;
}

/**
 * Permanent upgrades currently in force. An upgrade counts only while its content still exists and
 * its owning skill and every prerequisite are active, the same rule effects resolve by.
 */
export function activeUpgradeIds(
  player: SessionPlayer,
  content: GameContent = gameContent(),
): string[] {
  const skills = activeSkillIds(player);
  const unlocked = new Set(player.profile.unlockedUpgradeIds);
  return [...unlocked].filter((upgradeId) => {
    const upgrade = content.upgrades.get(upgradeId);
    return (
      upgrade !== undefined &&
      skills.has(upgrade.skillId) &&
      upgrade.requires.every((required) => unlocked.has(required))
    );
  });
}

/** The skill and upgrade definitions a client needs to describe progression. */
export function progressionCatalogFor(content: GameContent): ServerMessage {
  return {
    type: "progressionCatalog",
    skills: [...content.skills.values()].map((skill) => ({
      ...skill,
      effects: skill.effects.map((effect) => ({ ...effect })),
    })),
    upgrades: [...content.upgrades.values()].map((upgrade) => ({
      ...upgrade,
      requires: [...upgrade.requires],
      effects: upgrade.effects.map((effect) => ({ ...effect })),
    })),
  };
}

/**
 * One player's own progression. Ids the catalog no longer knows are withheld from the active
 * lists, because the server ignores them, but kept in the permanent ones so the profile is honest.
 */
export function progressionUpdateFor(
  player: SessionPlayer,
  content: GameContent,
): Extract<ServerMessage, { type: "progressionUpdated" }> {
  return {
    type: "progressionUpdated",
    unlockedSkillIds: [...player.profile.unlockedSkillIds],
    unlockedUpgradeIds: [...player.profile.unlockedUpgradeIds],
    runSkillIds: [...player.runSkillIds],
    activeSkillIds: [...activeSkillIds(player)].filter((id) => content.skills.has(id)),
    activeUpgradeIds: activeUpgradeIds(player, content),
  };
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
