import { DOWNED_EMOTE, type EmoteKind } from "../../shared/constants/emotes.js";
import type { RejectionReason, ServerMessage } from "../../shared/protocol/index.js";
import type { PlayerId } from "../../shared/types/core.js";
import { rosterOf, type Session, type SessionPlayer } from "../sessions/sessionStore.js";
import { isDown, isSpawned } from "./dungeonState.js";
import { visibilityFrameForPlayer } from "./visibility.js";

type PlayerEmoted = Extract<ServerMessage, { type: "playerEmoted" }>;

/**
 * Why the server refuses this emote from this player, or null if it may go out. A player with no
 * character is not in the world to emote from, and a downed one can only call for help.
 */
export function emoteRefusal(player: SessionPlayer, kind: EmoteKind): RejectionReason | null {
  if (!isSpawned(player)) return "notPermitted";
  if (isDown(player) && kind !== DOWNED_EMOTE) return "notPermitted";
  return null;
}

export function playerEmotedFor(session: Session, emoter: SessionPlayer, kind: EmoteKind): PlayerEmoted {
  return { type: "playerEmoted", playerId: emoter.id, kind, at: session.tick };
}

/**
 * Who sees an emote: the emoter, and every connected party member whose visible frame holds them
 * right now. Judged with the same frame the snapshot uses, so an emote reaches exactly the players
 * who can see its bubble, and cannot reveal someone standing in the dark.
 *
 * A fresh frame per viewer rather than one remembered from the last tick: an emote is rate-limited
 * to one a second, so this costs a handful of frames at most, and it can never be stale after a
 * move to a new world.
 */
export function emoteAudience(session: Session, emoter: SessionPlayer): PlayerId[] {
  const roster = rosterOf(session);
  const audience: PlayerId[] = [emoter.id];

  for (const viewer of session.players.values()) {
    if (viewer.id === emoter.id || !viewer.connected || !isSpawned(viewer)) continue;
    if (visibilityFrameForPlayer(session, viewer, roster).visiblePlayerIds.has(emoter.id)) {
      audience.push(viewer.id);
    }
  }

  return audience;
}
