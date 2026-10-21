import type { MilestoneStat } from "../../shared/constants/game.js";
import type { z } from "zod";
import type {
  MilestoneView,
  progressionEffectViewSchema,
  SkillView,
} from "../../shared/types/core.js";
import { selfOf, type ProgressionView, type SessionView } from "../network/sessionState.js";

type ProgressionEffectView = z.infer<typeof progressionEffectViewSchema>;

/** How a milestone's stat reads after "reach N", one phrase per stat so none is left unlabelled. */
const MILESTONE_STAT_LABELS: Record<MilestoneStat, string> = {
  runsEscaped: "escaped runs",
  fullPartyEscapes: "full-party escapes",
  wins: "wins",
  emberWardenKills: "Ember Warden kills",
  flawlessEmberWardenKills: "flawless Ember Warden kills",
  teammatesCarriedOut: "teammates carried out",
  leverPuzzlesSolved: "lever puzzles solved",
  runsWithoutTorch: "runs without a torch",
  itemsBanked: "items banked",
  mothRoomsFound: "moth rooms found",
};

/**
 * Where a skill sits for this player. `permanent` stacks survive the run; `provisional` ones were
 * learned this run and are lost unless the player reaches the hub. A held skill with both reads as
 * `permanent`, its provisional part counted in `runStacks`. A skill never held is `locked`, or
 * `unavailable` while a prerequisite is missing.
 */
export type SkillStatus = "permanent" | "provisional" | "locked" | "unavailable";

export interface SkillEntryView {
  skillId: string;
  name: string;
  description: string;
  status: SkillStatus;
  permanentStacks: number;
  runStacks: number;
  /** "2/3" for a capped skill, "3" for an unlimited one, null for one that does not stack or is not held. */
  stackText: string | null;
  /** What the held stacks add together, or null when none is held. */
  currentEffect: string | null;
  /** What one more stack adds, or null when not held, at its limit, or non-stacking. */
  nextEffect: string | null;
  /** Names of prerequisites the player lacks. */
  missingPrerequisites: string[];
  /** How a locked skill is earned; empty for a held one. */
  acquisition: string[];
}

export interface ScrollEntryView {
  itemId: string;
  name: string;
  skillName: string;
  where: "carried" | "vault";
  state: "blocked" | "maxed";
  text: string;
  /** Only a carried, maxed scroll: the server converts from the inventory alone. */
  canConvert: boolean;
}

export interface SkillsPanelView {
  /** False until the server has sent the catalog, so the panel can say it is waiting. */
  ready: boolean;
  skills: SkillEntryView[];
  scrolls: ScrollEntryView[];
  coin: number;
  runCoin: number;
}

const SKILL_ORDER: Record<SkillStatus, number> = { permanent: 0, provisional: 1, locked: 2, unavailable: 3 };

function effectPhrase(effect: ProgressionEffectView): string {
  switch (effect.type) {
    case "attackDamageBonus":
      return `+${effect.amount} attack damage`;
    case "sightRadiusBonus":
      return `+${effect.amount} sight radius`;
    case "resistanceBonus":
      return `+${effect.amount} resistance`;
    case "puzzlePowerBonus":
      return `+${effect.amount} puzzle power`;
  }
}

/** What stack `stack` (1-based) adds: the base effects, then the explicit list, then the per-stack rule. */
function stackEffects(skill: SkillView, stack: number): ProgressionEffectView[] {
  if (stack <= 1) return skill.effects;
  return skill.stackEffects[stack - 2] ?? skill.perStackEffects;
}

/** Effects summed by type, written out as one line, or null when there are none. */
function describeEffects(effects: readonly ProgressionEffectView[]): string | null {
  const totals = new Map<ProgressionEffectView["type"], number>();
  for (const effect of effects) totals.set(effect.type, (totals.get(effect.type) ?? 0) + effect.amount);
  const phrases = [...totals].map(([type, amount]) => effectPhrase({ type, amount } as ProgressionEffectView));
  return phrases.length > 0 ? phrases.join(", ") : null;
}

function milestoneText(milestone: MilestoneView, skills: readonly SkillView[]): string {
  const label = MILESTONE_STAT_LABELS[milestone.stat];
  const skill = skills.find((candidate) => candidate.id === milestone.skillId);
  return `Milestone ${milestone.name}: reach ${milestone.threshold} ${label}${skill ? ` to earn ${skill.name}` : ""}`;
}

function heldStacks(progression: ProgressionView, skillId: string): number {
  return (progression.skillStacks[skillId] ?? 0) + (progression.runSkillStacks[skillId] ?? 0);
}

function missingPrerequisites(progression: ProgressionView, skill: SkillView): string[] {
  return skill.requires
    .filter((id) => heldStacks(progression, id) === 0)
    .map((id) => progression.skills.find((candidate) => candidate.id === id)?.name ?? id);
}

function skillEntry(progression: ProgressionView, skill: SkillView): SkillEntryView {
  const permanentStacks = progression.skillStacks[skill.id] ?? 0;
  const runStacks = progression.runSkillStacks[skill.id] ?? 0;
  const held = permanentStacks + runStacks;
  // What the server's effects resolve from; it also respects a limit the catalog has since lowered.
  const active = progression.activeSkillStacks[skill.id] ?? 0;
  const missing = missingPrerequisites(progression, skill);

  const status: SkillStatus =
    held === 0 ? (missing.length > 0 ? "unavailable" : "locked") : permanentStacks > 0 ? "permanent" : "provisional";

  const stacking = skill.maxStacks === null || skill.maxStacks > 1;
  const stackText =
    held === 0 || !stacking ? null : skill.maxStacks === null ? `${held}` : `${held}/${skill.maxStacks}`;

  const resolved: ProgressionEffectView[] = [];
  for (let stack = 1; stack <= active; stack += 1) resolved.push(...stackEffects(skill, stack));
  const canStackMore = held > 0 && (skill.maxStacks === null || held < skill.maxStacks);

  const acquisition =
    held > 0
      ? []
      : [
          "Found as a skill scroll in the dungeon",
          ...progression.milestones
            .filter(
              (milestone) =>
                milestone.skillId === skill.id && !progression.earnedMilestones.includes(milestone.id),
            )
            .map((milestone) => milestoneText(milestone, progression.skills)),
        ];

  return {
    skillId: skill.id,
    name: skill.name,
    description: skill.description,
    status,
    permanentStacks,
    runStacks,
    stackText,
    currentEffect: describeEffects(resolved),
    nextEffect: canStackMore ? describeEffects(stackEffects(skill, held + 1)) : null,
    missingPrerequisites: missing,
    acquisition,
  };
}

function scrollEntries(view: SessionView, progression: ProgressionView): ScrollEntryView[] {
  const carried = selfOf(view)?.inventory ?? [];
  const entries: ScrollEntryView[] = [];
  for (const [where, items] of [
    ["carried", carried],
    ["vault", view.vault],
  ] as const) {
    for (const item of items) {
      if (item.kind !== "skillScroll") continue;
      const skill = progression.skills.find((candidate) => candidate.id === item.skillId);
      if (!skill) continue;

      const entry = { itemId: item.id, name: item.name, skillName: skill.name, where };
      const missing = missingPrerequisites(progression, skill);
      const maxed = skill.maxStacks !== null && heldStacks(progression, skill.id) >= skill.maxStacks;
      // A scroll missing a prerequisite cannot be used however many stacks are held, so it reads first.
      if (missing.length > 0) {
        entries.push({
          ...entry,
          state: "blocked",
          text: `Cannot be used yet: needs ${missing.join(", ")}`,
          canConvert: false,
        });
      } else if (maxed) {
        entries.push({
          ...entry,
          state: "maxed",
          text:
            where === "carried"
              ? `${skill.name} is at its limit. Convert to ${skill.conversionCoin} coin, or give it away.`
              : `${skill.name} is at its limit. Take it out to give it away or convert it.`,
          canConvert: where === "carried",
        });
      }
    }
  }
  return entries;
}

/**
 * Everything the Skills panel shows, from the owner-only progression the server sent. The client
 * adds nothing to it: every stack, limit, prerequisite and coin amount is the server's.
 */
export function skillsPanelView(view: SessionView): SkillsPanelView {
  const progression = view.progression;
  if (!progression || progression.skills.length === 0) {
    return { ready: false, skills: [], scrolls: [], coin: progression?.coin ?? 0, runCoin: progression?.runCoin ?? 0 };
  }

  const skills = progression.skills
    .map((skill) => skillEntry(progression, skill))
    .sort((a, b) => SKILL_ORDER[a.status] - SKILL_ORDER[b.status]);
  return {
    ready: true,
    skills,
    scrolls: scrollEntries(view, progression),
    coin: progression.coin,
    runCoin: progression.runCoin,
  };
}
