import { describe, expect, it } from "vitest";
import { emoteAudience, emoteRefusal, playerEmotedFor } from "../../src/server/game/emotes.js";
import { visibilityFrameForPlayer } from "../../src/server/game/visibility.js";
import { EMOTES } from "../../src/shared/constants/emotes.js";
import { at, testPlayer, testSession } from "./fixtures.js";

describe("emote refusals", () => {
  it("lets a standing player with a character send any emote", () => {
    const player = testPlayer("p");
    for (const kind of EMOTES) expect(emoteRefusal(player, kind), kind).toBeNull();
  });

  it("refuses a player with no character yet", () => {
    const player = testPlayer("p", { appearance: null });
    for (const kind of EMOTES) expect(emoteRefusal(player, kind), kind).toBe("notPermitted");
  });

  it("lets a downed player call for help and nothing else", () => {
    const player = testPlayer("p", { health: 0 });
    for (const kind of EMOTES) {
      expect(emoteRefusal(player, kind), kind).toBe(kind === "help" ? null : "notPermitted");
    }
  });
});

describe("emote audience", () => {
  /**
   * The emoter stands unlit in the far corner of the vault's top corridor: one viewer is right
   * beside them with a torch, the other is at the spawn at the far end, whose torch does not reach.
   */
  function party() {
    const emoter = testPlayer("emoter", { position: at(14, 1), carryingTorch: false });
    const near = testPlayer("near", { position: at(13, 1), carryingTorch: true });
    const far = testPlayer("far", { position: at(2, 2), carryingTorch: true });
    const session = testSession([emoter, near, far]);
    return { session, emoter, near, far };
  }

  it("is set up so one viewer sees the emoter and the other does not", () => {
    const { session, emoter, near, far } = party();
    expect(visibilityFrameForPlayer(session, near).visiblePlayerIds.has(emoter.id)).toBe(true);
    expect(visibilityFrameForPlayer(session, far).visiblePlayerIds.has(emoter.id)).toBe(false);
  });

  it("reaches the emoter and the viewers who can see them, and nobody in the dark", () => {
    const { session, emoter } = party();
    expect(emoteAudience(session, emoter).sort()).toEqual(["emoter", "near"]);
  });

  it("always reaches the emoter, even with nobody else in sight", () => {
    const { session, emoter, near } = party();
    session.players.delete(near.id);
    expect(emoteAudience(session, emoter)).toEqual(["emoter"]);
  });

  it("follows the light: a viewer who walks up and sees the emoter starts hearing them", () => {
    const { session, emoter, far } = party();
    far.position = at(12, 1);
    expect(emoteAudience(session, emoter).sort()).toEqual(["emoter", "far", "near"]);
  });

  it("skips a disconnected viewer and one still designing a character", () => {
    const { session, emoter, near } = party();
    near.connected = false;
    const designing = testPlayer("designing", { position: at(13, 1), appearance: null });
    session.players.set(designing.id, designing);

    expect(emoteAudience(session, emoter)).toEqual(["emoter"]);
  });
});

describe("playerEmoted", () => {
  it("names the emoter, the kind, and the tick it was accepted on", () => {
    const emoter = testPlayer("emoter");
    const session = testSession([emoter]);
    session.tick = 42;

    expect(playerEmotedFor(session, emoter, "followMe")).toStrictEqual({
      type: "playerEmoted",
      playerId: "emoter",
      kind: "followMe",
      at: 42,
    });
  });
});
