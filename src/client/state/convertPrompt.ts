import { selfOf, type SessionView } from "../network/sessionState.js";

/** What the maxed-scroll confirmation shows. Every number comes from the server's catalog. */
export interface ConvertPromptView {
  itemId: string;
  scrollName: string;
  coin: number;
  text: string;
  reminder: string;
}

/**
 * The confirmation for a scroll the server refused as maxed, or null when none is pending. Null as
 * well when the scroll is no longer carried or its skill is unknown, so the prompt never offers
 * something the server would refuse; it only ever asks, and the server judges again on Confirm.
 */
export function convertPromptView(view: SessionView): ConvertPromptView | null {
  if (view.convertPromptItemId === null) return null;
  const item = selfOf(view)?.inventory.find((candidate) => candidate.id === view.convertPromptItemId);
  if (item?.kind !== "skillScroll") return null;

  const skill = view.progression?.skills.find((candidate) => candidate.id === item.skillId);
  if (!skill) return null;

  return {
    itemId: item.id,
    scrollName: item.name,
    coin: skill.conversionCoin,
    text: `Convert to ${skill.conversionCoin} coin`,
    reminder: `You already know ${skill.name} as well as it can be known. Give this scroll to a teammate, or keep it for the vault, instead.`,
  };
}

/** The small balance readout, or null before the server has sent progression. */
export function coinReadout(view: SessionView): string | null {
  if (!view.progression) return null;
  const { coin, runCoin } = view.progression;
  return runCoin > 0 ? `Coin ${coin} (+${runCoin})` : `Coin ${coin}`;
}
