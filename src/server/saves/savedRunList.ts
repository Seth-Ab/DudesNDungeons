import type { SavedRunCard } from "../../shared/protocol/index.js";
import { PARTY_COLORS } from "../../shared/constants/appearance.js";
import type { ProfileId } from "../../shared/types/core.js";
import type { GameContent } from "../content/loadContent.js";
import { resolveAppearance, resolvePartyColor, type PersistedMember, type RoomSave } from "./roomSave.js";

type SavedRunCharacter = SavedRunCard["character"];

function characterOf(member: PersistedMember): SavedRunCharacter {
  return {
    name: member.name,
    appearance: resolveAppearance(member.appearance),
    // A colour since removed is only a ring on the card; the join assigns a free one.
    partyColor: resolvePartyColor(member.partyColor) ?? PARTY_COLORS[0],
  };
}

/**
 * The runs `profileId` could continue right now, most recently played first (decision 0015).
 *
 * A card needs a run, the profile's own entry in it (the same test `join` applies, so a listed run
 * is one the Continue button can enter) and the profile's character. Saves past `isExpired` are
 * left out; the store drops them for good on its next load.
 */
export function savedRunCardsFor(
  saves: readonly RoomSave[],
  profileId: ProfileId,
  content: Pick<GameContent, "dungeons">,
  isExpired: (save: RoomSave) => boolean,
): SavedRunCard[] {
  const cards: SavedRunCard[] = [];
  for (const save of saves) {
    if (save.run === null || isExpired(save)) continue;
    const entry = save.run.players.find((candidate) => candidate.profileId === profileId);
    const member = save.members.find((candidate) => candidate.profileId === profileId);
    if (entry === undefined || member === undefined) continue;

    const teammates = save.run.players
      .filter((candidate) => candidate.profileId !== profileId)
      .flatMap((candidate) => save.members.find((other) => other.profileId === candidate.profileId) ?? [])
      .map(characterOf);

    cards.push({
      roomCode: save.roomCode,
      dungeonName:
        save.run.dungeonId === undefined ? null : (content.dungeons.get(save.run.dungeonId)?.name ?? null),
      character: characterOf(member),
      teammates,
      playedMs: entry.runElapsedMs,
      lastPlayedAt: save.lastPlayedAt,
    });
  }
  return cards.sort((a, b) => b.lastPlayedAt - a.lastPlayedAt);
}
