import { DOWNED_EMOTE, EMOTES, type EmoteKind } from "../../shared/constants/emotes.js";
import type { PlayerId, PlayerState, Vector2 } from "../../shared/types/core.js";

/**
 * Emote bubbles and their wording, kept free of the canvas and the DOM so the node test
 * environment can drive them. The server only sends an emote to viewers who can see the emoter,
 * so everything that arrives is shown; a bubble is still only drawn while its emoter is in view.
 */

/** How long a bubble stays over its emoter. */
export const EMOTE_BUBBLE_LIFETIME_MS = 2000;
const MAX_BUBBLES = 8;

interface EmoteText {
  /** On the wheel. */
  name: string;
  /** In the bubble over the emoter's head. */
  bubble: string;
  /** In the action feed, after the emoter's name. */
  feed: string;
}

export const EMOTE_TEXT: Record<EmoteKind, EmoteText> = {
  wave: { name: "Wave", bubble: "*waves*", feed: "waves." },
  cheer: { name: "Cheer", bubble: "Hooray!", feed: "cheers!" },
  point: { name: "Point", bubble: "Over there!", feed: "points over there." },
  bow: { name: "Bow", bubble: "*bows*", feed: "bows." },
  dance: { name: "Dance", bubble: "*dances*", feed: "dances." },
  followMe: { name: "Follow me", bubble: "Follow me!", feed: "says follow me." },
  wait: { name: "Wait", bubble: "Wait!", feed: "says wait." },
  help: { name: "Help", bubble: "Help!", feed: "calls for help!" },
};

/** The emote a number key picks while the wheel is open: "1" is the first, "8" the last. */
export function emoteForDigit(key: string): EmoteKind | null {
  const index = Number.parseInt(key, 10) - 1;
  return /^[1-9]$/.test(key) && index < EMOTES.length ? EMOTES[index]! : null;
}

/** Mirrors the server's rule so the wheel can grey out what it would refuse. The server still decides. */
export function emoteAllowed(self: PlayerState | null, kind: EmoteKind): boolean {
  if (!self || self.appearance === null) return false;
  return self.health > 0 || kind === DOWNED_EMOTE;
}

/** The action feed's line for an emote: "Ash waves." for a party member, "You: Wave" for the local player. */
export function emoteFeedLine(
  players: readonly PlayerState[],
  selfId: PlayerId | null,
  playerId: PlayerId,
  kind: EmoteKind,
): string {
  if (playerId === selfId) return `You: ${EMOTE_TEXT[kind].name}`;
  const name = players.find((player) => player.id === playerId)?.name ?? "Someone";
  return `${name} ${EMOTE_TEXT[kind].feed}`;
}

/** One emote as the session view keeps it. `seq` orders them across messages. */
export interface EmoteRecord {
  seq: number;
  playerId: PlayerId;
  kind: EmoteKind;
}

export interface ActiveEmote {
  playerId: PlayerId;
  text: string;
  /** 0 when the bubble appears, 1 when it is gone. */
  progress: number;
}

/** A bubble with the world position it is drawn at this frame. */
export interface PlacedEmote extends ActiveEmote {
  position: Vector2;
}

interface TimedEmote {
  playerId: PlayerId;
  text: string;
  bornAt: number;
}

/**
 * The bubbles currently up. A player has at most one: a new emote replaces the old one rather than
 * stacking a second bubble on the same head.
 */
export function createEmoteField() {
  let bubbles: TimedEmote[] = [];

  return {
    add(playerId: PlayerId, kind: EmoteKind, now: number): void {
      bubbles = bubbles.filter((bubble) => bubble.playerId !== playerId);
      bubbles.push({ playerId, text: EMOTE_TEXT[kind].bubble, bornAt: now });
      if (bubbles.length > MAX_BUBBLES) bubbles = bubbles.slice(bubbles.length - MAX_BUBBLES);
    },

    /** Drops the expired ones and returns the rest. */
    active(now: number): ActiveEmote[] {
      bubbles = bubbles.filter((bubble) => now - bubble.bornAt < EMOTE_BUBBLE_LIFETIME_MS);
      return bubbles.map((bubble) => ({
        playerId: bubble.playerId,
        text: bubble.text,
        progress: Math.max(0, (now - bubble.bornAt) / EMOTE_BUBBLE_LIFETIME_MS),
      }));
    },

    clear(): void {
      bubbles = [];
    },
  };
}

/**
 * Pins each bubble to where its emoter is drawn this frame, dropping any whose emoter is not on
 * screen (they walked out of view while it was up). `positionOf` answers with the drawn position,
 * so a bubble follows the local prediction and remote interpolation rather than raw snapshots.
 */
export function placeEmotes(
  emotes: readonly ActiveEmote[],
  positionOf: (playerId: PlayerId) => Vector2 | null,
): PlacedEmote[] {
  const placed: PlacedEmote[] = [];
  for (const emote of emotes) {
    const position = positionOf(emote.playerId);
    if (position) placed.push({ ...emote, position });
  }
  return placed;
}

/** The emotes the view has recorded since `afterSeq`. */
export function newEmotes(recent: readonly EmoteRecord[], afterSeq: number): EmoteRecord[] {
  return recent.filter((emote) => emote.seq > afterSeq);
}
