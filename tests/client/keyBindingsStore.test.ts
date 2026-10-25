import { afterEach, describe, expect, it } from "vitest";
import {
  KEY_BINDINGS,
  keyLabel,
  resetBindings,
  setBinding,
} from "../../src/client/input/keyBindings.js";
import {
  createLocalStorageKeyBindingsStore,
  createMemoryKeyBindingsStore,
  parseBindingOverrides,
  persistKeyBindings,
} from "../../src/client/state/keyBindingsStore.js";

const KEY = "dnd.keyBindings";

function fakeStorage(initial?: string) {
  const items = new Map<string, string>(initial === undefined ? [] : [[KEY, initial]]);
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}

const throwingStorage = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};

afterEach(() => resetBindings());

describe("key bindings persistence", () => {
  it("round-trips a rebinding across a reload and shows it in the hint label", () => {
    const storage = fakeStorage();
    const stop = persistKeyBindings(createLocalStorageKeyBindingsStore(storage));
    expect(setBinding("interact", "g").ok).toBe(true);
    stop();
    expect(JSON.parse(storage.items.get(KEY) ?? "{}")).toEqual({ interact: "g" });

    resetBindings(); // a fresh page starts from the defaults
    persistKeyBindings(createLocalStorageKeyBindingsStore(storage));
    expect(KEY_BINDINGS.interact.keys).toEqual(["g"]);
    expect(keyLabel("interact")).toBe("G");
  });

  it("clears the stored value on reset", () => {
    const storage = fakeStorage();
    persistKeyBindings(createLocalStorageKeyBindingsStore(storage));
    setBinding("interact", "g");
    expect(storage.items.has(KEY)).toBe(true);
    resetBindings();
    expect(storage.items.has(KEY)).toBe(false);
  });

  it("falls back to defaults for corrupt JSON and non-object data", () => {
    for (const raw of ["{nope", "null", "[]", '"e"', "7", ""]) {
      expect(parseBindingOverrides(raw)).toEqual({});
    }
  });

  it("does not throw when storage is unavailable", () => {
    const store = createLocalStorageKeyBindingsStore(throwingStorage);
    expect(store.read()).toEqual({});
    expect(() => persistKeyBindings(store)).not.toThrow();
    expect(() => setBinding("interact", "g")).not.toThrow();
    expect(keyLabel("interact")).toBe("G");
  });

  it("ignores an unknown action", () => {
    expect(parseBindingOverrides('{"dance":"g","interact":"h"}')).toEqual({ interact: "h" });
  });

  it("ignores reserved, modifier and non-string keys", () => {
    const raw = JSON.stringify({ interact: "Escape", pickup: "`", carry: "shift", drop: 5, give: "ArrowUp", attack: "" });
    expect(parseBindingOverrides(raw)).toEqual({});
  });

  it("drops entries that clash with each other or with another action's default", () => {
    expect(parseBindingOverrides('{"interact":"g","pickup":"g"}')).toEqual({});
    // "r" is the default of drawBow, which has no stored entry.
    expect(parseBindingOverrides('{"interact":"r"}')).toEqual({});
    // A clean swap is not a conflict.
    expect(parseBindingOverrides('{"interact":"f","pickup":"e"}')).toEqual({ interact: "f", pickup: "e" });
  });

  it("applies only the valid entries from a mixed set", () => {
    const store = createMemoryKeyBindingsStore();
    store.write(parseBindingOverrides('{"interact":"g","pickup":"escape","carry":"g"}'));
    persistKeyBindings(store);
    expect(KEY_BINDINGS.interact.keys).toEqual(["e"]);
    expect(KEY_BINDINGS.pickup.keys).toEqual(["f"]);
    expect(KEY_BINDINGS.carry.keys).toEqual(["c"]);
  });
});
