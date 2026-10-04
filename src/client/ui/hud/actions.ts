import type { ControlsView } from "../../state/hudView.js";
import { createButton } from "./dom.js";

interface ActionOptions {
  onAttack: () => void;
  onPickup: () => void;
  onInteract: () => void;
  onCarry: () => void;
  onUseSlot: (slot: number) => void;
}

/** Attack, pickup, interact, carry, and the three item-use buttons. */
export function createActions(options: ActionOptions) {
  const attack = createButton("Attack", options.onAttack);
  const pickup = createButton("Pickup", options.onPickup);
  const interact = createButton("Interact", options.onInteract);
  const carry = createButton("Carry", options.onCarry);
  const use = [0, 1, 2].map((slot) => createButton(`Use ${slot + 1}`, () => options.onUseSlot(slot)));

  return {
    elements: [attack, pickup, interact, carry, ...use],

    update(view: ControlsView) {
      attack.disabled = view.actionsDisabled;
      pickup.disabled = view.actionsDisabled;
      interact.disabled = view.actionsDisabled;
      carry.disabled = view.actionsDisabled;
      carry.textContent = view.carryLabel;
      use.forEach((button, slot) => {
        button.disabled = view.useDisabled[slot] ?? true;
      });
    },
  };
}
