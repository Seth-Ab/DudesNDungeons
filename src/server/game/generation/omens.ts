/**
 * Omens (decision 0016): the run modifiers a `delve` run rolls in its recipe stage.
 *
 * A run has at most one warning and one anomaly. They are rolled from the run seed's own stream,
 * after the flow and the biome, so the same seed always rolls the same omens and a retry never
 * changes them. `omenEffects` folds the rolled omens into the knobs the populate stage reads.
 */
import { RESISTANCE_DECAY_GRACE_MS } from "../../../shared/constants/game.js";
import type { GameContent } from "../../content/loadContent.js";
import type { DelveDungeon, OmenDefinition } from "../../content/schema.js";
import type { Rng } from "../random.js";

/** What the rolled omens do to generation. Every field is neutral when no omen touches it. */
export interface OmenEffects {
  /** Scales how many fixed lights a room gets. */
  readonly lightMult: number;
  /** Scales the radius of every light. */
  readonly radiusMult: number;
  /** Scales every room's threat budget. */
  readonly budgetMult: number;
  /** Added to the chance of every chest roll. */
  readonly chestBonus: number;
  /** Trap type dropped along the corridors, or null. */
  readonly corridorTrap: string | null;
  /** Whether a skill scroll cache is guaranteed. */
  readonly shrine: boolean;
}

export const NO_OMEN_EFFECTS: OmenEffects = {
  lightMult: 1,
  radiusMult: 1,
  budgetMult: 1,
  chestBonus: 0,
  corridorTrap: null,
  shrine: false,
};

const byId = (a: OmenDefinition, b: OmenDefinition): number => a.id.localeCompare(b.id);

/**
 * Rolls at most one warning and one anomaly. The warning's roll comes first, so adding anomalies
 * to the catalog never changes which warning a seed gets. Draws nothing for a kind with no omens.
 */
export function rollOmens(rng: Rng, definition: Pick<DelveDungeon, "omens">, content: GameContent): OmenDefinition[] {
  const catalog = [...content.omens.values()].sort(byId);
  const rolled: OmenDefinition[] = [];
  const kinds = [
    { type: "warning", chance: definition.omens.warningChance },
    { type: "anomaly", chance: definition.omens.anomalyChance },
  ] as const;
  for (const { type, chance } of kinds) {
    const pool = catalog.filter((omen) => omen.type === type);
    if (pool.length > 0 && rng.chance(chance)) rolled.push(rng.pick(pool));
  }
  return rolled;
}

/** The omens named by `ids`, for a test or a tool that forces a run's omens. Refuses a pair of one kind. */
export function chooseOmens(ids: readonly string[], content: GameContent): OmenDefinition[] {
  const chosen = ids.map((id) => {
    const omen = content.omens.get(id);
    if (!omen) throw new Error(`Unknown omen "${id}"`);
    return omen;
  });
  for (const type of ["warning", "anomaly"] as const) {
    if (chosen.filter((omen) => omen.type === type).length > 1) throw new Error(`A run has at most one ${type}`);
  }
  return chosen;
}

/** Folds omens into generation knobs: multipliers multiply, the chest bonus adds, flags latch. */
export function omenEffects(omens: readonly OmenDefinition[]): OmenEffects {
  let effects = NO_OMEN_EFFECTS;
  for (const omen of omens) {
    effects = {
      lightMult: effects.lightMult * (omen.lightMult ?? 1),
      radiusMult: effects.radiusMult * (omen.radiusMult ?? 1),
      budgetMult: effects.budgetMult * (omen.budgetMult ?? 1),
      chestBonus: effects.chestBonus + (omen.chestBonus ?? 0),
      corridorTrap: omen.corridorTraps ?? effects.corridorTrap,
      shrine: effects.shrine || omen.shrine === true,
    };
  }
  return effects;
}

/** What a run's omens do to the rules that are global constants otherwise. */
export interface OmenOverrides {
  /** How long into a run before resistance starts to decay, in milliseconds. */
  readonly decayGraceMs: number;
  /** Multiplier on how far a voice carries. */
  readonly voiceRangeMult: number;
}

/** Folds omens into run-scoped rules: the shortest grace wins and voice multipliers multiply. */
export function omenOverrides(omens: readonly Pick<OmenDefinition, "overrides">[]): OmenOverrides {
  let decayGraceMs = RESISTANCE_DECAY_GRACE_MS;
  let voiceRangeMult = 1;
  for (const omen of omens) {
    decayGraceMs = Math.min(decayGraceMs, omen.overrides?.decayGraceMs ?? decayGraceMs);
    voiceRangeMult *= omen.overrides?.voiceRangeMult ?? 1;
  }
  return { decayGraceMs, voiceRangeMult };
}

/** The run-scoped rules for omens named by id; an id the content no longer holds is ignored. */
export function overridesFor(ids: readonly string[], content: GameContent): OmenOverrides {
  return omenOverrides(ids.flatMap((id) => content.omens.get(id) ?? []));
}
