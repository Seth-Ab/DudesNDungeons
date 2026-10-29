import type { HubNextRun } from "../network/sessionState.js";

/**
 * How the next run's omens read on the hub's quest board and in the party's hub status. Free of the
 * DOM so the node test environment can drive it. The server rolls the omens; this only says how each
 * one looks, and never by colour alone: a warning is a triangle and an anomaly a diamond, and each
 * also carries its type as a word.
 */

export type HubOmen = HubNextRun["omens"][number];
export type OmenShape = "triangle" | "diamond";

export interface OmenMark {
  shape: OmenShape;
  /** The shape as text, for the HUD list. */
  glyph: string;
  /** The type spelled out, so a screen reader or a colour-blind player is never left guessing. */
  word: string;
  /** The accent for the shape; the shape and word carry the meaning without it. */
  accent: string;
}

const OMEN_MARKS: Record<HubOmen["type"], OmenMark> = {
  warning: { shape: "triangle", glyph: "▲", word: "Warning", accent: "#e0885a" },
  anomaly: { shape: "diamond", glyph: "◆", word: "Anomaly", accent: "#7fb6e8" },
};

export function omenMark(type: HubOmen["type"]): OmenMark {
  return OMEN_MARKS[type];
}

/** What the board says when the next run carries no omen. */
export const NO_OMENS_TEXT = "No omens";

export interface OmenLine {
  id: string;
  name: string;
  mark: OmenMark;
  /** Spoken and hovered: "Warning: Short Fuse. <description>". */
  label: string;
}

/** One line per omen in the order the server sent, or none until the hub has sent the next run. */
export function omenLines(nextRun: HubNextRun | null): OmenLine[] {
  return (nextRun?.omens ?? []).map((omen) => {
    const mark = omenMark(omen.type);
    return { id: omen.id, name: omen.name, mark, label: `${mark.word}: ${omen.name}. ${omen.description}` };
  });
}
