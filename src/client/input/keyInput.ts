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
export function createKeyInput(onAction?: (action: GameplayAction) => void) {
  const held = new Set<MoveDirection>();

  return {
    keyDown(key: string, repeat: boolean): boolean {
      const direction = directionForKey(key);
      if (direction) {
        held.add(direction);
        return true;
      }
      const action = actionForKey(key);
      if (!action) return false;
      if (!repeat) onAction?.(action as GameplayAction);
      return true;
    },
    keyUp(key: string): void {
      const direction = directionForKey(key);
      if (direction) held.delete(direction);
    },
    heading(): Vector2 | null {
      return headingFrom(held);
    },
    clear(): void {
      held.clear();
    },
  };
}
