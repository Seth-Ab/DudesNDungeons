import {
  PLAYER_MAX_RESISTANCE,
  PLAYER_TORCH_LIGHT_RADIUS,
} from "../../shared/constants/game.js";
import type { ServerMessage } from "../../shared/protocol/index.js";
import { gameContent, type GameContent } from "../content/loadContent.js";
import type { ProgressionEffect, SkillDefinition } from "../content/schema.js";
import { markProfileChanged } from "../profiles/profile.js";
import type { Session, SessionPlayer } from "../sessions/sessionStore.js";

export type ProgressionEffectType = ProgressionEffect["type"];

/** The immutable catalog used to build this session's worlds and resolve its progression. */
export function contentForSession(session: Session): GameContent {
  return session.runDungeon.content ?? gameContent();
}

/** Permanent plus provisional stacks of one skill, uncapped: what the limit and prerequisites count. */
export function heldStacks(player: SessionPlayer, skillId: string): number {
  return (player.profile.skillStacks[skillId] ?? 0) + (player.runSkillStacks.get(skillId) ?? 0);
}

/**
 * Stacks in force per skill: permanent plus provisional, capped at the skill's current
 * `maxStacks`. A skill content no longer has is left out rather than crashing a live session,
 * since profiles are durable and content can change between releases; a count above a lowered
 * limit stays stored but only counts up to the limit.
 */
export function activeSkillStacks(
  player: SessionPlayer,
  content: GameContent = gameContent(),
): Map<string, number> {
  const active = new Map<string, number>();
  const skillIds = new Set([
    ...Object.keys(player.profile.skillStacks),
    ...player.runSkillStacks.keys(),
  ]);
  for (const skillId of skillIds) {
    const skill = content.skills.get(skillId);
    if (!skill) continue;
    const held = heldStacks(player, skillId);
    const stacks = skill.maxStacks === null ? held : Math.min(held, skill.maxStacks);
    if (stacks > 0) active.set(skillId, stacks);
  }
  return active;
}

/** The effects one skill grants at a stack count: its first stack, then each further stack. */
function effectsAtStacks(skill: SkillDefinition, stacks: number): ProgressionEffect[] {
  const effects = [...skill.effects];
  for (let stack = 2; stack <= stacks; stack += 1) {
    effects.push(...(skill.stackEffects?.[stack - 2] ?? skill.perStackEffects ?? []));
  }
  return effects;
}

/** Adds one supported effect across every active skill stack. */
export function progressionEffectTotal(
  player: SessionPlayer,
  type: ProgressionEffectType,
  content: GameContent = gameContent(),
): number {
  let total = 0;
  for (const [skillId, stacks] of activeSkillStacks(player, content)) {
    for (const effect of effectsAtStacks(content.skills.get(skillId)!, stacks)) {
      if (effect.type === type) total += effect.amount;
    }
  }
  return total;
}

/** The skill definitions a client needs to describe progression. */
export function progressionCatalogFor(content: GameContent): ServerMessage {
  return {
    type: "progressionCatalog",
    skills: [...content.skills.values()].map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      effects: skill.effects.map((effect) => ({ ...effect })),
      maxStacks: skill.maxStacks,
      requires: [...skill.requires],
      conversionCoin: skill.conversionCoin,
      stackEffects: (skill.stackEffects ?? []).map((stack) => stack.map((effect) => ({ ...effect }))),
      perStackEffects: (skill.perStackEffects ?? []).map((effect) => ({ ...effect })),
    })),
    milestones: [...content.milestones.values()].map((milestone) => ({ ...milestone })),
  };
}

/**
 * One player's own progression. Skills the catalog no longer knows are withheld from the active
 * stacks, because the server ignores them, but kept in the permanent ones so the profile is honest.
 */
export function progressionUpdateFor(
  player: SessionPlayer,
  content: GameContent,
): Extract<ServerMessage, { type: "progressionUpdated" }> {
  return {
    type: "progressionUpdated",
    skillStacks: { ...player.profile.skillStacks },
    runSkillStacks: Object.fromEntries(player.runSkillStacks),
    activeSkillStacks: Object.fromEntries(activeSkillStacks(player, content)),
    coin: player.profile.coin,
    runCoin: player.runCoin,
    stats: { ...player.profile.stats },
    earnedMilestones: [...player.profile.earnedMilestones],
    ownedCosmeticIds: [...player.profile.ownedCosmeticIds],
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

export type LearnSkillResult = "learned" | "unknownSkill" | "skillMaxed" | "missingPrerequisites";

/**
 * Uses a scroll: adds one stack of its skill. A dungeon stack is provisional; a hub stack is
 * permanent immediately because the hub is the save boundary. The limit and prerequisites count
 * permanent and provisional stacks together, so a prerequisite learned earlier this run qualifies.
 * Anything but `learned` changes nothing, so the caller can leave the scroll where it is.
 */
export function learnSkill(session: Session, player: SessionPlayer, skillId: string): LearnSkillResult {
  const skill = contentForSession(session).skills.get(skillId);
  if (!skill) return "unknownSkill";
  const held = heldStacks(player, skillId);
  if (skill.maxStacks !== null && held >= skill.maxStacks) return "skillMaxed";
  if (skill.requires.some((requiredId) => heldStacks(player, requiredId) < 1)) {
    return "missingPrerequisites";
  }

  if (session.location === "hub") {
    player.profile.skillStacks[skillId] = (player.profile.skillStacks[skillId] ?? 0) + 1;
    markProfileChanged(player.profile);
  } else {
    player.runSkillStacks.set(skillId, (player.runSkillStacks.get(skillId) ?? 0) + 1);
  }
  return "learned";
}

/** Saves provisional run stacks for a player who made it out. */
export function bankRunSkills(player: SessionPlayer): void {
  for (const [skillId, stacks] of player.runSkillStacks) {
    player.profile.skillStacks[skillId] = (player.profile.skillStacks[skillId] ?? 0) + stacks;
  }
  player.runSkillStacks.clear();
}

/** Drops every provisional stack when a player does not make it out. */
export function discardRunSkills(player: SessionPlayer): void {
  player.runSkillStacks.clear();
}

/** Saves the run purse for a player who made it out. */
export function bankRunCoin(player: SessionPlayer): void {
  if (player.runCoin > 0) {
    player.profile.coin += player.runCoin;
    markProfileChanged(player.profile);
  }
  player.runCoin = 0;
}

/** Drops the run purse when a player does not make it out. */
export function discardRunCoin(player: SessionPlayer): void {
  player.runCoin = 0;
}

export type ConvertScrollResult = "converted" | "unknownSkill" | "skillNotMaxed";

/**
 * Converts a scroll's skill into coin: the purse in a dungeon, the profile in the hub (the save
 * boundary). Only a skill already at its limit converts, counting permanent and provisional stacks
 * and any excess above a lowered limit. Anything but `converted` changes nothing.
 */
export function convertScrollSkill(
  session: Session,
  player: SessionPlayer,
  skillId: string,
): ConvertScrollResult {
  const skill = contentForSession(session).skills.get(skillId);
  if (!skill) return "unknownSkill";
  if (skill.maxStacks === null || heldStacks(player, skillId) < skill.maxStacks) {
    return "skillNotMaxed";
  }

  if (session.location === "hub") {
    player.profile.coin += skill.conversionCoin;
    markProfileChanged(player.profile);
  } else {
    player.runCoin += skill.conversionCoin;
  }
  return "converted";
}
