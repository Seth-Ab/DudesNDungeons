/**
 * The one table of rebindable keys, as runtime state. The input controller reads it to decide what
 * a keypress does, and the controls menu, the contextual prompt, and the hotbar read it to say which
 * key to press, so a rebinding cannot leave the on-screen hint naming a key that no longer works.
 * Bindings are per page (so per client) and are not persisted.
 */

export type GameplayAction =
  | "attack"
  | "pickup"
  | "interact"
  | "carry"
  | "useSlot1"
  | "useSlot2"
  | "useSlot3";

export type MovementAction = "moveNorth" | "moveSouth" | "moveWest" | "moveEast";

export type BindableAction = GameplayAction | MovementAction;

export interface KeyBinding {
  /** Values of `KeyboardEvent.key`, lower-cased. */
  keys: readonly string[];
  /** What the key is called on screen. */
  label: string;
}

/** Backquote toggles the debug readouts; it cannot be rebound. */
export const DEBUG_KEY = "`";

/** Never bindable: Escape cancels and closes menus, the debug key is fixed, arrows stay movement. */
const RESERVED_KEYS = new Set(["escape", DEBUG_KEY, "arrowup", "arrowdown", "arrowleft", "arrowright"]);

/** Pressing one of these alone is a modifier, not a key choice. */
const MODIFIER_KEYS = new Set(["shift", "control", "alt", "meta", "altgraph", "capslock", "dead", "unidentified"]);

const DEFAULT_KEYS: Record<BindableAction, string> = {
  attack: " ",
  interact: "e",
  pickup: "f",
  carry: "c",
  useSlot1: "1",
  useSlot2: "2",
  useSlot3: "3",
  moveNorth: "w",
  moveWest: "a",
  moveSouth: "s",
  moveEast: "d",
};

export const BINDABLE_ACTIONS = Object.keys(DEFAULT_KEYS) as BindableAction[];

export const USE_SLOT_ACTIONS: readonly GameplayAction[] = ["useSlot1", "useSlot2", "useSlot3"];

/** What each movement binding does, in the directions the input controller holds. */
export const MOVEMENT_DIRECTIONS: Record<MovementAction, "north" | "south" | "west" | "east"> = {
  moveNorth: "north",
  moveSouth: "south",
  moveWest: "west",
  moveEast: "east",
};

/** What each action is called in messages and in the controls menu. */
export const ACTION_NAMES: Record<BindableAction, string> = {
  attack: "Attack",
  pickup: "Pick up",
  interact: "Interact",
  carry: "Carry",
  useSlot1: "Use slot 1",
  useSlot2: "Use slot 2",
  useSlot3: "Use slot 3",
  moveNorth: "Move up",
  moveSouth: "Move down",
  moveWest: "Move left",
  moveEast: "Move right",
};

/** How a key (`KeyboardEvent.key`) is printed on screen: " " is "Space", letters are capitalised. */
export function labelForKey(key: string): string {
  if (key === " ") return "Space";
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function defaultBinding(action: BindableAction): KeyBinding {
  const key = DEFAULT_KEYS[action];
  return { keys: [key], label: labelForKey(key) };
}

/** Live table: mutated in place by `setBinding` and `resetBindings`, never replaced. */
export const KEY_BINDINGS = Object.fromEntries(
  BINDABLE_ACTIONS.map((action) => [action, defaultBinding(action)]),
) as Record<BindableAction, KeyBinding>;

export type BindingResult =
  | { ok: true }
  | { ok: false; reason: "reserved" | "modifier" | "conflict"; heldBy?: BindableAction };

const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** Calls `listener` after every change to the table; returns the unsubscribe. */
export function onBindingsChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Binds `key` (a `KeyboardEvent.key`) to `action`, refusing reserved keys and keys another action holds. */
export function setBinding(action: BindableAction, key: string): BindingResult {
  const normalized = key.toLowerCase();
  if (MODIFIER_KEYS.has(normalized)) return { ok: false, reason: "modifier" };
  if (RESERVED_KEYS.has(normalized)) return { ok: false, reason: "reserved" };

  const holder = actionForKey(normalized);
  if (holder && holder !== action) return { ok: false, reason: "conflict", heldBy: holder };

  KEY_BINDINGS[action] = { keys: [normalized], label: labelForKey(normalized) };
  notify();
  return { ok: true };
}

export function resetBindings(): void {
  for (const action of BINDABLE_ACTIONS) KEY_BINDINGS[action] = defaultBinding(action);
  notify();
}

export function keyLabel(action: BindableAction): string {
  return KEY_BINDINGS[action].label;
}

/** The action a key (`KeyboardEvent.key`, any case) is bound to right now, if any. */
export function actionForKey(key: string): BindableAction | undefined {
  const normalized = key.toLowerCase();
  return BINDABLE_ACTIONS.find((action) => KEY_BINDINGS[action].keys.includes(normalized));
}

/** `KeyboardEvent.key` (lower-cased) to the action it triggers. */
export function actionKeyMap(): Map<string, BindableAction> {
  const map = new Map<string, BindableAction>();
  for (const action of BINDABLE_ACTIONS) {
    for (const key of KEY_BINDINGS[action].keys) map.set(key, action);
  }
  return map;
}

/** The sentence shown when `setBinding` refuses. */
export function bindingMessage(key: string, result: Extract<BindingResult, { ok: false }>): string {
  const label = labelForKey(key.toLowerCase());
  if (result.reason === "conflict" && result.heldBy) {
    return `${label} is already bound to ${ACTION_NAMES[result.heldBy]}.`;
  }
  if (result.reason === "modifier") return "Press a regular key, not a modifier.";
  return `${label} is reserved and cannot be bound.`;
}
