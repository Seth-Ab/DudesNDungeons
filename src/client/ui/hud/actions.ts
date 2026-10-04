import type { ControlsView } from "../../state/hudView.js";
import { createButton } from "./dom.js";

interface ActionOptions {
  onAttack: () => void;
}

/**
 * Attack stays as a mouse/touch fallback. Pickup, interact, and carry are the contextual prompt's
 * job now, and the item slots are the hotbar's.
 */
export function createActions(options: ActionOptions) {
  const attack = createButton("Attack", options.onAttack);

  return {
    elements: [attack],

    update(view: ControlsView) {
      attack.disabled = view.actionsDisabled;
    },
  };
}
