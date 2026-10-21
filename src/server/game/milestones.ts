import type { GameContent } from "../content/loadContent.js";
import { markProfileChanged } from "../profiles/profile.js";
import type { Session, SessionPlayer } from "../sessions/sessionStore.js";
import { isDown } from "./dungeonState.js";
import { heldStacks } from "./progression.js";

/**
 * Milestone stats (decision 0014).
 *
 * A player's `RunStats` gather what happened to them during one run. They are credited to the
 * profile only when the run ends and only to a player who extracts, by the predicate that saves
 * provisional skills, so a wipe or being left behind earns nothing. Crediting can cross a milestone
 * threshold, which grants its skill once.
 */

/** What one player did this run, before it is known whether they get out. */
export interface RunStats {
  leverPuzzlesSolved: number;
  emberWardenKills: number;
  flawlessEmberWardenKills: number;
  /** True once this player entered the hidden moth room this run. */
  mothRoomFound: boolean;
  /** True if this player carried a torch at any point this run. */
  carriedTorch: boolean;
  /** True if this player was downed this run. Read when the Ember Warden falls. */
  downed: boolean;
}

export function createRunStats(): RunStats {
  return {
    leverPuzzlesSolved: 0,
    emberWardenKills: 0,
    flawlessEmberWardenKills: 0,
    mothRoomFound: false,
    carriedTorch: false,
    downed: false,
  };
}

/** Clears a player's run stats as a run starts, keeping a torch picked up in the hub. */
export function beginRunStats(player: SessionPlayer): void {
  player.runStats = createRunStats();
  player.runStats.carriedTorch = player.carryingTorch;
}

/** Credits every player holding a plate of a puzzle that has just been solved. */
export function recordPuzzleSolved(holders: readonly SessionPlayer[]): void {
  for (const holder of holders) holder.runStats.leverPuzzlesSolved += 1;
}

/**
 * Credits the standing players when the Ember Warden falls. The kill is the party's: a player who
 * was down at that moment was not part of it. It is flawless when nobody in the party has been
 * downed at any point this run.
 */
export function recordEmberWardenKill(session: Session): void {
  const players = [...session.players.values()];
  const flawless = players.every((player) => !player.runStats.downed);
  for (const player of players) {
    if (isDown(player)) continue;
    player.runStats.emberWardenKills += 1;
    if (flawless) player.runStats.flawlessEmberWardenKills += 1;
  }
}

/** What the whole run adds to a player's profile that is not already in their `RunStats`. */
export interface RunOutcome {
  /** Every player in the party got out, carried or standing. */
  fullParty: boolean;
  /** The dungeon had a boss and every boss fell before the exit. */
  bossesDefeated: boolean;
  /** Teammates this player carried out. */
  carriedOut: number;
  /** Items this player banked into the vault. */
  itemsBanked: number;
}

/** Adds one extractor's run to their profile stats. */
export function creditRunStats(player: SessionPlayer, outcome: RunOutcome): void {
  const { stats } = player.profile;
  const run = player.runStats;

  stats.runsEscaped += 1;
  if (outcome.fullParty) stats.fullPartyEscapes += 1;
  if (outcome.bossesDefeated) stats.wins += 1;
  stats.emberWardenKills += run.emberWardenKills;
  stats.flawlessEmberWardenKills += run.flawlessEmberWardenKills;
  stats.teammatesCarriedOut += outcome.carriedOut;
  stats.leverPuzzlesSolved += run.leverPuzzlesSolved;
  if (!run.carriedTorch) stats.runsWithoutTorch += 1;
  stats.itemsBanked += outcome.itemsBanked;
  if (run.mothRoomFound) stats.mothRoomsFound += 1;
  markProfileChanged(player.profile);
}

/**
 * Earns every milestone whose stat has reached its threshold, granting one permanent stack of its
 * skill. Each is earned once: the id is recorded even when the skill is already at its limit, which
 * grants nothing more. A threshold already passed when a milestone first ships is met at the next
 * extraction rather than lost. Returns the ids earned now.
 */
export function grantMilestones(player: SessionPlayer, content: GameContent): string[] {
  const { profile } = player;
  const earned: string[] = [];

  for (const milestone of content.milestones.values()) {
    if (profile.earnedMilestones.includes(milestone.id)) continue;
    if (profile.stats[milestone.stat] < milestone.threshold) continue;

    const skill = content.skills.get(milestone.skillId);
    const atLimit =
      skill !== undefined && skill.maxStacks !== null && heldStacks(player, skill.id) >= skill.maxStacks;
    if (skill && !atLimit) {
      profile.skillStacks[skill.id] = (profile.skillStacks[skill.id] ?? 0) + 1;
    }
    profile.earnedMilestones.push(milestone.id);
    earned.push(milestone.id);
  }

  if (earned.length > 0) markProfileChanged(profile);
  return earned;
}
