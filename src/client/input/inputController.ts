import type { MoveDirection } from "../state/gameState";

type InputControllerOptions = {
  onMove: (direction: MoveDirection) => void;
};

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

export function createInputController(options: InputControllerOptions) {
  const onKeyDown = (event: KeyboardEvent) => {
    const direction = movementKeys.get(event.key.toLowerCase());

    if (!direction) {
      return;
    }

    event.preventDefault();
    options.onMove(direction);
  };

  return {
    start() {
      window.addEventListener("keydown", onKeyDown);
    },
    stop() {
      window.removeEventListener("keydown", onKeyDown);
    },
  };
}
