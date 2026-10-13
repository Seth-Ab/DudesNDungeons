import { afterEach, describe, expect, it, vi } from "vitest";
import {
  actionForKey,
  actionKeyMap,
  bindingMessage,
  KEY_BINDINGS,
  keyLabel,
  labelForKey,
  onBindingsChange,
  resetBindings,
  setBinding,
  type BindableAction,
} from "../../src/client/input/keyBindings.js";

afterEach(() => resetBindings());

describe("key bindings", () => {
  it("maps every bound key back to its action", () => {
    const map = actionKeyMap();
    for (const [action, binding] of Object.entries(KEY_BINDINGS) as [BindableAction, { keys: readonly string[] }][]) {
      for (const key of binding.keys) expect(map.get(key)).toBe(action);
    }
  });

  it("binds no key twice", () => {
    const keys = Object.values(KEY_BINDINGS).flatMap((binding) => binding.keys);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("derives labels from the bound key", () => {
    expect(labelForKey(" ")).toBe("Space");
    expect(labelForKey("x")).toBe("X");
    expect(labelForKey("enter")).toBe("Enter");
    expect(labelForKey("5")).toBe("5");
  });

  it("rebinds an action, drops the old key, and notifies", () => {
    const listener = vi.fn();
    const off = onBindingsChange(listener);
    expect(setBinding("interact", "X")).toEqual({ ok: true });
    expect(keyLabel("interact")).toBe("X");
    expect(actionForKey("x")).toBe("interact");
    expect(actionForKey("e")).toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    resetBindings();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("lets the swap key be rebound", () => {
    expect(actionForKey("v")).toBe("swapHeld");
    expect(setBinding("swapHeld", "z")).toEqual({ ok: true });
    expect(actionForKey("z")).toBe("swapHeld");
    expect(actionForKey("v")).toBeUndefined();
    expect(keyLabel("swapHeld")).toBe("Z");
  });

  it("labels a key rebound to Space", () => {
    setBinding("interact", " ");
    // Space was attack's, so it is a conflict and nothing changes.
    expect(keyLabel("interact")).toBe("E");
    setBinding("attack", "x");
    expect(setBinding("interact", " ")).toEqual({ ok: true });
    expect(keyLabel("interact")).toBe("Space");
  });

  it("rejects a key another action holds and leaves both bindings alone", () => {
    const result = setBinding("interact", "f");
    expect(result).toEqual({ ok: false, reason: "conflict", heldBy: "pickup" });
    expect(keyLabel("interact")).toBe("E");
    expect(keyLabel("pickup")).toBe("F");
    expect(bindingMessage("f", result as { ok: false; reason: "conflict"; heldBy: BindableAction })).toBe(
      "F is already bound to Pick up.",
    );
  });

  it("allows rebinding an action to the key it already has", () => {
    expect(setBinding("interact", "e")).toEqual({ ok: true });
  });

  it("rejects reserved and modifier keys", () => {
    for (const key of ["Escape", "`", "ArrowUp", "ArrowLeft"]) {
      expect(setBinding("interact", key)).toEqual({ ok: false, reason: "reserved" });
    }
    expect(setBinding("interact", "Shift")).toEqual({ ok: false, reason: "modifier" });
    expect(keyLabel("interact")).toBe("E");
  });

  it("rebinds movement directions", () => {
    expect(setBinding("moveNorth", "i")).toEqual({ ok: true });
    expect(actionForKey("i")).toBe("moveNorth");
    expect(actionForKey("w")).toBeUndefined();
  });

  it("resets every binding", () => {
    setBinding("interact", "x");
    setBinding("moveEast", "l");
    resetBindings();
    expect(keyLabel("interact")).toBe("E");
    expect(keyLabel("moveEast")).toBe("D");
  });

  it("binds the minimap toggle to M and lets it be rebound", () => {
    expect(actionForKey("m")).toBe("toggleMinimap");
    expect(setBinding("toggleMinimap", "n")).toEqual({ ok: true });
    expect(actionForKey("n")).toBe("toggleMinimap");
    expect(actionForKey("m")).toBeUndefined();
  });
});
