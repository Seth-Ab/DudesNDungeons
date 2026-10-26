import { distance } from "../../shared/game/movement.js";
import type { AltarState, Vector2 } from "../../shared/types/core.js";
import type { SessionView } from "../network/sessionState.js";

/**
 * How a shrine altar looks and what taking from it means, from the snapshot alone.
 *
 * Free of the DOM so it can be tested under node. The server owns the rules (the first take wins,
 * the rest are caged for the run); this only turns the altar it sent into slots to draw and a
 * scroll to name in the prompt.
 */

/** World units between neighbouring scroll slots, matching the plinths in the `altar` sprite. */
export const ALTAR_SLOT_SPACING = 2;

/** How high above its centre a scroll rests, so it sits on the plinth rather than the slab. */
export const ALTAR_SCROLL_LIFT = 0.7;

/** The name on the plate a player sees within reach. */
export const ALTAR_PLATE = "Shrine Altar";

/** `offered` is still takeable, `taken` is the scroll the party chose, `caged` was shut away by that choice. */
export type AltarSlotState = "offered" | "taken" | "caged";

export interface AltarSlot {
  itemId: string;
  state: AltarSlotState;
  position: Vector2;
}

/** The state of the whole altar: open until a take succeeds, then spent. */
export function altarPhase(altar: AltarState): "offered" | "spent" {
  return altar.taken === null ? "offered" : "spent";
}

/** Each offered scroll's slot, laid left to right about the altar's centre. */
export function altarSlots(altar: AltarState): AltarSlot[] {
  const count = altar.offer.length;

  return altar.offer.map((itemId, index) => ({
    itemId,
    state: altar.taken === null ? "offered" : altar.taken === itemId ? "taken" : "caged",
    position: {
      x: altar.position.x + (index - (count - 1) / 2) * ALTAR_SLOT_SPACING,
      y: altar.position.y,
    },
  }));
}

/** The offered slot nearest a point, or null once the altar is spent. Ties go to the first. */
export function nearestOfferedSlot(altar: AltarState, point: Vector2): AltarSlot | null {
  let best: AltarSlot | null = null;
  let bestGap = Number.POSITIVE_INFINITY;
  for (const slot of altarSlots(altar)) {
    if (slot.state !== "offered") continue;
    const gap = distance(point, slot.position);
    if (gap < bestGap) {
      best = slot;
      bestGap = gap;
    }
  }

  return best;
}

/**
 * A scroll's name. The client holds no item catalogue, but a skill scroll's item id is its skill's
 * id plus `-scroll`, and the skill catalogue is in the snapshot; an unknown id falls back to its
 * own words, title-cased.
 */
export function scrollName(view: SessionView, itemId: string): string {
  const skillId = itemId.replace(/-scroll$/, "");
  const skill = view.progression?.skills.find((candidate) => candidate.id === skillId);
  const words = skill?.name ?? skillId.split("-").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");

  return `Scroll of ${words}`;
}
