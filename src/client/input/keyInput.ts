import type { Vector2 } from "../../shared/types/core.js";
import { headingFrom, type MoveDirection } from "../state/gameState.js";
import { actionForKey, MOVEMENT_DIRECTIONS, type GameplayAction, type MovementAction } from "./keyBindings.js";

/** Arrow keys are fixed movement aliases; the letter keys come from the rebindable table. */
const ARROW_KEYS = new Map<string, MoveDirection>([
  ["arrowup", "north"],
  ["arrowdown", "south"],
  ["arrowleft", "west"],
  ["arrowright", "east"],
]);

/** Actions that last as long as their key is down: pressing starts them and letting go ends them. */
const HOLD_ACTIONS: ReadonlySet<GameplayAction> = new Set<GameplayAction>(["drawBow"]);

function directionForKey(key: string): MoveDirection | undefined {
  const lower = key.toLowerCase();
  const arrow = ARROW_KEYS.get(lower);
  if (arrow) return arrow;
  const action = actionForKey(lower);
  return action && action in MOVEMENT_DIRECTIONS ? MOVEMENT_DIRECTIONS[action as MovementAction] : undefined;
}

/**
 * The DOM-free half of the input controller: which keys are held and which action a press
 * triggers. Keys resolve through the live binding table on every press, so a rebinding applies at
 * once. `keyDown` returns true when the key was consumed, so the caller can `preventDefault`.
 */
export function createKeyInput(
  onAction?: (action: GameplayAction) => void,
  onRelease?: (action: GameplayAction) => void,
) {
  const held = new Set<MoveDirection>();
  // By the key that started each one, so a rebinding mid-hold still ends it on the key that is down.
  const heldActions = new Map<string, GameplayAction>();

  return {
    keyDown(key: string, repeat: boolean): boolean {
      const direction = directionForKey(key);
      if (direction) {
        held.add(direction);
        return true;
      }
      const action = actionForKey(key);
      if (!action) return false;
      if (HOLD_ACTIONS.has(action as GameplayAction)) {
        // Key repeat sends keydown over and over; only the first press starts the hold.
        if (!repeat && !heldActions.has(key.toLowerCase())) {
          heldActions.set(key.toLowerCase(), action as GameplayAction);
          onAction?.(action as GameplayAction);
        }
        return true;
      }
      if (!repeat) onAction?.(action as GameplayAction);
      return true;
    },
    keyUp(key: string): void {
      const direction = directionForKey(key);
      if (direction) held.delete(direction);
      const action = heldActions.get(key.toLowerCase());
      if (action && heldActions.delete(key.toLowerCase())) onRelease?.(action);
    },
    heading(): Vector2 | null {
      return headingFrom(held);
    },
    clear(): void {
      held.clear();
      // Focus lost mid-draw: let go, so the draw is not left running with no key down.
      const released = [...heldActions.values()];
      heldActions.clear();
      for (const action of released) onRelease?.(action);
    },
  };
}
