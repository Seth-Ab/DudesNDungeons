import { describe, expect, it } from "vitest";
import {
  saveConfirmation,
  saveQuitButtonLabel,
  saveQuitStillPending,
} from "../../src/client/state/saveQuit.js";

describe("Save and quit feedback", () => {
  it("labels the button Saving... while pending", () => {
    expect(saveQuitButtonLabel(true)).toBe("Saving...");
    expect(saveQuitButtonLabel(false)).toBe("Save and quit");
  });

  it("stays pending until a refusal arrives or the player leaves the dungeon", () => {
    expect(saveQuitStillPending(true, null, true)).toBe(true);
    expect(saveQuitStillPending(true, "You are in combat.", true)).toBe(false);
    expect(saveQuitStillPending(true, null, false)).toBe(false);
    expect(saveQuitStillPending(false, null, true)).toBe(false);
  });

  it("names the room and says how to continue", () => {
    const { title, text } = saveConfirmation("BCDFGH");
    expect(title).toBe("Run saved");
    expect(text).toContain("BCDFGH");
    expect(text).toContain("Join dungeon");
  });
});
