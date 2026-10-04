import { describe, expect, it } from "vitest";
import { actionKeyMap, KEY_BINDINGS, keyLabel, type GameplayAction } from "../../src/client/input/keyBindings.js";

describe("key bindings", () => {
  it("maps every bound key back to its action", () => {
    const map = actionKeyMap();
    for (const [action, binding] of Object.entries(KEY_BINDINGS) as [GameplayAction, { keys: readonly string[] }][]) {
      for (const key of binding.keys) expect(map.get(key)).toBe(action);
    }
  });

  it("binds no key twice", () => {
    const keys = Object.values(KEY_BINDINGS).flatMap((binding) => binding.keys);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("labels the keys the prompt and controls menu print", () => {
    expect(keyLabel("attack")).toBe("Space");
    expect(keyLabel("pickup")).toBe("F");
    expect(keyLabel("useSlot2")).toBe("2");
  });
});
