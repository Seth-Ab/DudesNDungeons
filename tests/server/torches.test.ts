import { describe, expect, it } from "vitest";
import { lightTorch, putOutTorch } from "../../src/server/game/torches.js";
import { visibilityFrameForPlayer, visibleTilesForPlayer } from "../../src/server/game/visibility.js";
import { toPlayerState } from "../../src/server/sessions/sessionStore.js";
import { INTERACT_RANGE } from "../../src/shared/constants/game.js";
import { at, testPlayer, testSession } from "./fixtures.js";

const FIXED_LIGHT_ID = "77777777-7777-4777-8777-777777777777";

/** Two torch carriers side by side, with no other lights in the dungeon. */
function pair() {
  const maya = testPlayer("maya", { position: at(2, 2) });
  const noor = testPlayer("noor", { position: at(2, 2, 0.5) });
  const session = testSession([maya, noor]);
  session.dungeon.lightSources = [];
  return { maya, noor, session };
}

function litAtFeet(session: ReturnType<typeof pair>["session"], viewer: ReturnType<typeof testPlayer>): boolean {
  return visibleTilesForPlayer(session, viewer).hasAt(Math.floor(viewer.position.x), Math.floor(viewer.position.y));
}

describe("putting a torch out", () => {
  it("puts out the sender's own lit torch", () => {
    const { maya, session } = pair();

    expect(putOutTorch(session, "maya")).toEqual({ ok: true });

    expect(maya.carryingTorch).toBe(true);
    expect(maya.torchLit).toBe(false);
  });

  it("refuses a player without a torch, an unknown player, and a torch that is already out", () => {
    const { maya, noor, session } = pair();
    noor.carryingTorch = false;
    maya.torchLit = false;

    expect(putOutTorch(session, "noor")).toEqual({ ok: false, reason: "notPermitted" });
    expect(putOutTorch(session, "nobody")).toEqual({ ok: false, reason: "notPermitted" });
    expect(putOutTorch(session, "maya")).toEqual({ ok: false, reason: "notPermitted" });
  });

  it("refuses a downed or disconnected player", () => {
    const { maya, noor, session } = pair();
    maya.health = 0;
    noor.connected = false;

    expect(putOutTorch(session, "maya")).toEqual({ ok: false, reason: "notPermitted" });
    expect(putOutTorch(session, "noor")).toEqual({ ok: false, reason: "notPermitted" });
    expect(maya.torchLit).toBe(true);
    expect(noor.torchLit).toBe(true);
  });

  it("only ever touches the sender's torch", () => {
    const { maya, noor, session } = pair();

    putOutTorch(session, "maya");

    expect(noor.torchLit).toBe(true);
    expect(maya.torchLit).toBe(false);
  });

  it("lights no tiles for anyone while out, and lights them again once relit", () => {
    const { maya, noor, session } = pair();
    expect(litAtFeet(session, maya)).toBe(true);

    putOutTorch(session, "maya");
    putOutTorch(session, "noor");
    expect(litAtFeet(session, maya)).toBe(false);
    expect(visibilityFrameForPlayer(session, noor).dungeon.lightSources).toEqual([]);

    // Noor's relit torch is in the very next frame, and it lights the ground for maya too.
    noor.torchLit = true;
    expect(visibilityFrameForPlayer(session, maya).dungeon.lightSources.map((light) => light.id)).toEqual(["noor"]);
    expect(litAtFeet(session, maya)).toBe(true);
  });
});

describe("relighting a torch", () => {
  it("relights from another player's lit torch within reach", () => {
    const { maya, session } = pair();
    putOutTorch(session, "maya");

    expect(lightTorch(session, "maya")).toEqual({ ok: true });

    expect(maya.torchLit).toBe(true);
  });

  it("relights from a lit fixed light within reach", () => {
    const { maya, noor, session } = pair();
    noor.carryingTorch = false;
    putOutTorch(session, "maya");
    session.dungeon.lightSources = [
      { id: FIXED_LIGHT_ID, name: "Torch Pillar", kind: "fixed", position: at(2, 2, INTERACT_RANGE - 0.1), radius: 4 },
    ];

    expect(lightTorch(session, "maya")).toEqual({ ok: true });
    expect(maya.torchLit).toBe(true);
  });

  it("relights from a downed player's torch, which keeps burning", () => {
    const { noor, session } = pair();
    noor.health = 0;
    putOutTorch(session, "maya");

    expect(lightTorch(session, "maya")).toEqual({ ok: true });
  });

  it("refuses when the other torch is out of reach", () => {
    const { maya, noor, session } = pair();
    noor.position = at(2, 2, INTERACT_RANGE + 1);
    putOutTorch(session, "maya");

    expect(lightTorch(session, "maya")).toEqual({ ok: false, reason: "outOfRange" });
    expect(maya.torchLit).toBe(false);
  });

  it("refuses a fixed light out of reach", () => {
    const { noor, session } = pair();
    noor.carryingTorch = false;
    putOutTorch(session, "maya");
    session.dungeon.lightSources = [
      { id: FIXED_LIGHT_ID, name: "Torch Pillar", kind: "fixed", position: at(2, 2, INTERACT_RANGE + 1), radius: 4 },
    ];

    expect(lightTorch(session, "maya")).toEqual({ ok: false, reason: "outOfRange" });
  });

  it("refuses to relight from a torch that is itself out", () => {
    const { maya, session } = pair();
    putOutTorch(session, "maya");
    putOutTorch(session, "noor");

    expect(lightTorch(session, "maya")).toEqual({ ok: false, reason: "outOfRange" });
    expect(lightTorch(session, "noor")).toEqual({ ok: false, reason: "outOfRange" });
    expect(maya.torchLit).toBe(false);
  });

  it("refuses with no flame at all, and a flare is not a fixed light", () => {
    const { noor, session } = pair();
    noor.carryingTorch = false;
    putOutTorch(session, "maya");
    expect(lightTorch(session, "maya")).toEqual({ ok: false, reason: "outOfRange" });

    session.dungeon.lightSources = [{ id: FIXED_LIGHT_ID, name: "Flare", kind: "flare", position: at(2, 2), radius: 4 }];
    expect(lightTorch(session, "maya")).toEqual({ ok: false, reason: "outOfRange" });
  });

  it("refuses a lit torch, a player without a torch, and a downed player", () => {
    const { maya, noor, session } = pair();
    expect(lightTorch(session, "maya")).toEqual({ ok: false, reason: "notPermitted" });

    noor.carryingTorch = false;
    noor.torchLit = false;
    expect(lightTorch(session, "noor")).toEqual({ ok: false, reason: "notPermitted" });

    putOutTorch(session, "maya");
    maya.health = 0;
    expect(lightTorch(session, "maya")).toEqual({ ok: false, reason: "notPermitted" });
  });

  it("does not count a disconnected carrier's torch, and an unlit torch stays unlit for a rejoining player", () => {
    const { maya, noor, session } = pair();
    putOutTorch(session, "maya");
    noor.connected = false;

    expect(lightTorch(session, "maya")).toEqual({ ok: false, reason: "outOfRange" });

    // The slot is held while disconnected, so a rejoining player gets the torch state they left.
    maya.connected = false;
    expect(lightTorch(session, "maya")).toEqual({ ok: false, reason: "notPermitted" });
    maya.connected = true;
    expect(toPlayerState(maya)).toMatchObject({ carryingTorch: true, torchLit: false });
  });
});
