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

  it("starts a draw on the first press only and ends it when the key goes up", () => {
    const onAction = vi.fn();
    const onRelease = vi.fn();
    const input = createKeyInput(onAction, onRelease);
    input.keyDown("r", false);
    input.keyDown("r", true);
    input.keyDown("r", false);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction).toHaveBeenCalledWith("drawBow");
    expect(onRelease).not.toHaveBeenCalled();

    input.keyUp("r");
    expect(onRelease).toHaveBeenCalledExactlyOnceWith("drawBow");
    input.keyUp("r");
    expect(onRelease).toHaveBeenCalledTimes(1);
  });

  it("ends a draw on the key that started it even after a rebinding, and on losing focus", () => {
    const onRelease = vi.fn();
    const input = createKeyInput(vi.fn(), onRelease);
    input.keyDown("r", false);
    setBinding("drawBow", "x");
    input.keyUp("r");
    expect(onRelease).toHaveBeenCalledExactlyOnceWith("drawBow");

    input.keyDown("x", false);
    input.clear();
    expect(onRelease).toHaveBeenCalledTimes(2);
  });

  it("does not release for a key that is not a hold action", () => {
    const onRelease = vi.fn();
    const input = createKeyInput(vi.fn(), onRelease);
    input.keyDown("e", false);
    input.keyUp("e");
    expect(onRelease).not.toHaveBeenCalled();
  });
});
