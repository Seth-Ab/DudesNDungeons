import { describe, expect, it } from "vitest";
import {
  formatLastPlayed,
  formatTimePlayed,
  savedRunDetails,
  savedRunTitle,
} from "../../src/client/state/savedRuns.js";
import { applyServerMessage, initialSessionView } from "../../src/client/network/sessionState.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("saved run card text", () => {
  it("formats time played", () => {
    expect(formatTimePlayed(20_000)).toBe("under a minute in");
    expect(formatTimePlayed(34 * MINUTE + 5_000)).toBe("34 min in");
    expect(formatTimePlayed(HOUR)).toBe("1 h in");
    expect(formatTimePlayed(HOUR + 5 * MINUTE)).toBe("1 h 5 min in");
  });

  it("formats when a save was last played", () => {
    const now = 10 * DAY;
    expect(formatLastPlayed(now - 5_000, now)).toBe("just now");
    expect(formatLastPlayed(now - 12 * MINUTE, now)).toBe("12m ago");
    expect(formatLastPlayed(now - 2 * HOUR, now)).toBe("2h ago");
    expect(formatLastPlayed(now - DAY - HOUR, now)).toBe("yesterday");
    expect(formatLastPlayed(now - 5 * DAY, now)).toBe("5d ago");
    expect(formatLastPlayed(now + HOUR, now)).toBe("just now");
  });

  it("titles a card with the dungeon only when the save names one", () => {
    expect(savedRunTitle("Seth", "Ember Vault")).toBe("Seth · Ember Vault");
    expect(savedRunTitle("Seth", null)).toBe("Seth");
  });

  it("puts the room, time and recency on the detail line", () => {
    expect(savedRunDetails({ roomCode: "KX7QFB", playedMs: 34 * MINUTE, lastPlayedAt: 0 }, 2 * HOUR)).toBe(
      "Room KX7QFB · 34 min in · 2h ago",
    );
  });
});

describe("the saved-run list in the session view", () => {
  it("is unknown until the server answers, then holds the server's list", () => {
    expect(initialSessionView.savedRuns).toBeNull();

    const view = applyServerMessage(initialSessionView, { type: "savedRuns", runs: [] });

    expect(view.savedRuns).toEqual([]);
  });
});
