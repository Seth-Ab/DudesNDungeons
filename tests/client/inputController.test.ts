import { afterEach, describe, expect, it, vi } from "vitest";
import { createKeyInput } from "../../src/client/input/keyInput.js";
import { resetBindings, setBinding } from "../../src/client/input/keyBindings.js";

afterEach(() => resetBindings());

describe("key input", () => {
  it("fires the action bound to a key", () => {
    const onAction = vi.fn();
    const input = createKeyInput(onAction);
    input.keyDown("e", false);
    expect(onAction).toHaveBeenCalledWith("interact");
  });

  it("follows a rebound key and ignores the old one", () => {
    const onAction = vi.fn();
    const input = createKeyInput(onAction);
    setBinding("interact", "x");
    input.keyDown("e", false);
    expect(onAction).not.toHaveBeenCalled();
    input.keyDown("X", false);
    expect(onAction).toHaveBeenCalledWith("interact");
  });

  it("does not repeat an action while the key is held", () => {
    const onAction = vi.fn();
    const input = createKeyInput(onAction);
    input.keyDown("e", false);
    input.keyDown("e", true);
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("moves with the default keys and the arrow keys", () => {
    const input = createKeyInput();
    input.keyDown("w", false);
    expect(input.heading()).toEqual({ x: 0, y: -1 });
    input.keyUp("w");
    expect(input.heading()).toBeNull();
    input.keyDown("ArrowRight", false);
    expect(input.heading()).toEqual({ x: 1, y: 0 });
  });

  it("follows a rebound movement key, ignores the old one, and keeps the arrows", () => {
    const input = createKeyInput();
    setBinding("moveNorth", "i");
    input.keyDown("w", false);
    expect(input.heading()).toBeNull();
    input.keyDown("i", false);
    expect(input.heading()).toEqual({ x: 0, y: -1 });
    input.keyUp("i");
    input.keyDown("ArrowUp", false);
    expect(input.heading()).toEqual({ x: 0, y: -1 });
  });
});
