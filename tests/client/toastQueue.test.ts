import { describe, expect, it } from "vitest";
import { DEFAULT_TOAST_TTL_MS, createToastQueue } from "../../src/client/state/toastQueue.js";

describe("toast queue", () => {
  it("shows a message and expires it after its severity's lifetime", () => {
    const queue = createToastQueue();

    expect(queue.show("gate", "Waiting for the party.", "info", 0)).toBe(true);
    expect(queue.visible().map((toast) => toast.text)).toEqual(["Waiting for the party."]);

    expect(queue.expire(DEFAULT_TOAST_TTL_MS.info - 1)).toBe(false);
    expect(queue.expire(DEFAULT_TOAST_TTL_MS.info)).toBe(true);
    expect(queue.visible()).toEqual([]);
  });

  it("carries severity and honours a per-message lifetime", () => {
    const queue = createToastQueue();
    queue.show("error", "Nope.", "error", 0);
    queue.show("outcome", "You escaped.", "info", 0, 20_000);

    expect(queue.visible().map((toast) => toast.severity)).toEqual(["error", "info"]);
    queue.expire(DEFAULT_TOAST_TTL_MS.error);
    expect(queue.visible().map((toast) => toast.key)).toEqual(["outcome"]);
  });

  it("does not re-queue the same text from the same source on every snapshot", () => {
    const queue = createToastQueue();

    expect(queue.show("torch", "No torch.", "warning", 0)).toBe(true);
    expect(queue.show("torch", "No torch.", "warning", 50)).toBe(false);
    expect(queue.visible()).toHaveLength(1);
    // Repeating the text does not extend its life either.
    expect(queue.visible()[0]?.expiresAt).toBe(DEFAULT_TOAST_TTL_MS.warning);
  });

  it("does not bring an expired message back while its condition persists", () => {
    const queue = createToastQueue();
    queue.show("gate", "Waiting.", "info", 0);
    queue.expire(10_000);

    expect(queue.show("gate", "Waiting.", "info", 10_050)).toBe(false);
    expect(queue.visible()).toEqual([]);
  });

  it("shows the message again once its source has cleared and recurs", () => {
    const queue = createToastQueue();
    queue.show("torch", "No torch.", "warning", 0);

    expect(queue.show("torch", "", "warning", 100)).toBe(true);
    expect(queue.visible()).toEqual([]);
    expect(queue.show("torch", "No torch.", "warning", 200)).toBe(true);
    expect(queue.visible()).toHaveLength(1);
  });

  it("updates a source in place when its text changes", () => {
    const queue = createToastQueue();
    queue.show("decay", "Resistance starts falling in 60s.", "warning", 0);
    queue.show("decay", "Resistance starts falling in 59s.", "warning", 1000);

    expect(queue.visible()).toHaveLength(1);
    expect(queue.visible()[0]).toMatchObject({
      text: "Resistance starts falling in 59s.",
      expiresAt: 1000 + DEFAULT_TOAST_TTL_MS.warning,
    });
  });

  it("keeps separate sources separate and drops the oldest past the limit", () => {
    const queue = createToastQueue(2);
    queue.show("a", "one", "info", 0);
    queue.show("b", "two", "info", 0);
    queue.show("c", "three", "info", 0);

    expect(queue.visible().map((toast) => toast.key)).toEqual(["b", "c"]);
  });

  it("clearing an unknown source changes nothing", () => {
    expect(createToastQueue().clear("missing")).toBe(false);
  });
});
