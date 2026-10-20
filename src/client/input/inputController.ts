import type { Vector2 } from "../../shared/types/core.js";
import { createKeyInput } from "./keyInput.js";
import type { GameplayAction } from "./keyBindings.js";

export type { GameplayAction };

interface InputControllerOptions {
  onAction?: (action: GameplayAction) => void;
  /** A hold action (drawing a bow) whose key went up, or was let go of when the window lost focus. */
  onRelease?: (action: GameplayAction) => void;
}

/** Keys typed into a form field belong to that field, such as a player name containing "w". */
export function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName))
  );
}

/**
 * Tracks which movement keys are held. The game polls `heading()` on the server's move interval
 * instead of moving on keydown, because key repeat starts after a pause and fires at a rate that
 * has nothing to do with the server's. Key resolution lives in `keyInput.ts`.
 */
export function createInputController(options: InputControllerOptions = {}) {
  const keys = createKeyInput(options.onAction, options.onRelease);

  const onKeyDown = (event: KeyboardEvent) => {
    if (isTypingTarget(event.target)) return;
    if (keys.keyDown(event.key, event.repeat)) event.preventDefault();
  };

  const onKeyUp = (event: KeyboardEvent) => keys.keyUp(event.key);

  // A key released while the window is unfocused never fires keyup, which would leave the player
  // walking on their own.
  const onBlur = () => keys.clear();

  return {
    heading(): Vector2 | null {
      return keys.heading();
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
      keys.clear();
    },
  };
}
