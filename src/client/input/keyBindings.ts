/**
 * The one table of gameplay keys. The input controller reads it to decide what a keypress does, and
 * the controls menu and the contextual prompt read it to say which key to press, so a rebinding
 * cannot leave the on-screen hint naming a key that no longer works.
 */

export type GameplayAction =
  | "attack"
  | "pickup"
  | "interact"
  | "carry"
  | "useSlot1"
  | "useSlot2"
  | "useSlot3";

export interface KeyBinding {
  /** Values of `KeyboardEvent.key`, lower-cased. */
  keys: readonly string[];
  /** What the key is called on screen. */
  label: string;
}

export const KEY_BINDINGS: Record<GameplayAction, KeyBinding> = {
  attack: { keys: [" "], label: "Space" },
  interact: { keys: ["e"], label: "E" },
  pickup: { keys: ["f"], label: "F" },
  carry: { keys: ["c"], label: "C" },
  useSlot1: { keys: ["1"], label: "1" },
  useSlot2: { keys: ["2"], label: "2" },
  useSlot3: { keys: ["3"], label: "3" },
};

export const USE_SLOT_ACTIONS: readonly GameplayAction[] = ["useSlot1", "useSlot2", "useSlot3"];

export function keyLabel(action: GameplayAction): string {
  return KEY_BINDINGS[action].label;
}

/** `KeyboardEvent.key` (lower-cased) to the action it triggers. */
export function actionKeyMap(): Map<string, GameplayAction> {
  const map = new Map<string, GameplayAction>();
  for (const [action, binding] of Object.entries(KEY_BINDINGS) as [GameplayAction, KeyBinding][]) {
    for (const key of binding.keys) map.set(key, action);
  }
  return map;
}
