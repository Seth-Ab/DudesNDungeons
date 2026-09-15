import type { Vector2 } from "../../shared/types/core.js";
import { headingFrom, type MoveDirection } from "../state/gameState.js";

export type GameplayAction = "attack" | "pickup" | "interact" | "useSlot1" | "useSlot2" | "useSlot3";

interface InputControllerOptions {
  onAction?: (action: GameplayAction) => void;
}

const movementKeys = new Map<string, MoveDirection>([
  ["arrowup", "north"],
  ["w", "north"],
  ["arrowdown", "south"],
  ["s", "south"],
  ["arrowleft", "west"],
  ["a", "west"],
  ["arrowright", "east"],
  ["d", "east"],
]);

const actionKeys = new Map<string, GameplayAction>([
  [" ", "attack"],
  ["e", "interact"],
  ["f", "pickup"],
  ["1", "useSlot1"],
  ["2", "useSlot2"],
  ["3", "useSlot3"],
]);

/** Keys typed into a form field belong to that field, such as a player name containing "w". */
function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

/**
 * Tracks which movement keys are held. The game polls `heading()` on the server's move interval
 * instead of moving on keydown, because key repeat starts after a pause and fires at a rate that
 * has nothing to do with the server's.
 */
export function createInputController(options: InputControllerOptions = {}) {
  const held = new Set<MoveDirection>();

  const onKeyDown = (event: KeyboardEvent) => {
    if (isTypingTarget(event.target)) return;

    const action = actionKeys.get(event.key.toLowerCase());
    if (action) {
      event.preventDefault();
      if (!event.repeat) options.onAction?.(action);
      return;
    }

    const direction = movementKeys.get(event.key.toLowerCase());
    if (!direction) return;

    event.preventDefault();
    held.add(direction);
  };

  const onKeyUp = (event: KeyboardEvent) => {
    const direction = movementKeys.get(event.key.toLowerCase());
    if (direction) held.delete(direction);
  };

  // A key released while the window is unfocused never fires keyup, which would leave the player
  // walking on their own.
  const onBlur = () => held.clear();

  return {
    heading(): Vector2 | null {
      return headingFrom(held);
    },
    start() {
      window.addEventListener("keydown", onKeyDown);
      window.addEventListener("keyup", onKeyUp);
      window.addEventListener("blur", onBlur);
    },
    stop() {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      held.clear();
    },
  };
}
