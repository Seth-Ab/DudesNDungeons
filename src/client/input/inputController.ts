import { MAX_INVENTORY_SIZE } from "../../shared/constants/game.js";
import type { Vector2 } from "../../shared/types/core.js";
import { headingFrom, type MoveDirection } from "../state/gameState.js";

export type GameAction =
  | { type: "attack" }
  | { type: "interact" }
  | { type: "drinkTonic" }
  | { type: "useSlot"; slot: number }
  | { type: "toggleMenu" };

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

const actionKeys = new Map<string, GameAction>([
  [" ", { type: "attack" }],
  ["j", { type: "attack" }],
  ["e", { type: "interact" }],
  ["q", { type: "drinkTonic" }],
  ["escape", { type: "toggleMenu" }],
]);

/** Number keys 1 through the inventory size use that slot. */
function actionFor(key: string): GameAction | undefined {
  const slot = Number(key);
  if (key.trim() !== "" && Number.isInteger(slot) && slot >= 1 && slot <= MAX_INVENTORY_SIZE) {
    return { type: "useSlot", slot: slot - 1 };
  }
  return actionKeys.get(key.toLowerCase());
}

/** Keys typed into a form field belong to that field, such as a player name containing "w". */
function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

interface InputControllerOptions {
  onAction: (action: GameAction) => void;
}

/**
 * Tracks held movement keys and reports one-shot actions. The game polls `heading()` on the server's
 * move interval instead of moving on keydown, because key repeat starts after a pause and fires at a
 * rate that has nothing to do with the server's.
 */
export function createInputController(options: InputControllerOptions) {
  const held = new Set<MoveDirection>();

  const onKeyDown = (event: KeyboardEvent) => {
    if (isTypingTarget(event.target)) return;

    const direction = movementKeys.get(event.key.toLowerCase());
    if (direction) {
      event.preventDefault();
      held.add(direction);
      return;
    }

    const action = actionFor(event.key);
    if (!action) return;

    event.preventDefault();
    // Holding an action key would otherwise fire it on every auto-repeat.
    if (!event.repeat) options.onAction(action);
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
