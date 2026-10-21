import { describe, expect, it } from "vitest";
import { dropCarry, liftPlayer } from "../../src/server/game/carrying.js";
import { advanceVitals } from "../../src/server/game/vitals.js";
import { returnToHub } from "../../src/server/game/runLifecycle.js";
import { SessionStore } from "../../src/server/sessions/sessionStore.js";
import {
  CARRY_STAMINA_DRAIN_PER_SECOND,
  INTERACT_RANGE,
  LIFT_STAMINA_COST,
} from "../../src/shared/constants/game.js";
import { at, testPlayer, testSession } from "./fixtures.js";

describe("lifting a downed player", () => {
  it("links carrier and target and spends the lift cost", () => {
    const carrier = testPlayer("alpha", { position: at(2, 2), stamina: LIFT_STAMINA_COST });
    const downed = testPlayer("beta", { position: at(2, 2, 0.6), health: 0 });
    const session = testSession([carrier, downed]);

    expect(liftPlayer(session, carrier.id, downed.id)).toEqual({ ok: true });

    expect(carrier.carryingPlayerId).toBe(downed.id);
    expect(downed.carriedByPlayerId).toBe(carrier.id);
    expect(downed.position).toEqual(carrier.position);
    expect(carrier.stamina).toBe(0);
  });

  it("refuses a standing target", () => {
    const carrier = testPlayer("alpha", { position: at(2, 2) });
    const standing = testPlayer("beta", { position: at(2, 2, 0.6) });
    const session = testSession([carrier, standing]);

    expect(liftPlayer(session, carrier.id, standing.id)).toEqual({
      ok: false,
      reason: "notPermitted",
    });
  });

  it("refuses a target out of reach", () => {
    const carrier = testPlayer("alpha", { position: at(2, 2) });
    const downed = testPlayer("beta", { position: at(9, 9), health: 0 });
    const session = testSession([carrier, downed]);

    expect(liftPlayer(session, carrier.id, downed.id)).toEqual({
      ok: false,
      reason: "outOfRange",
    });
  });

  it("refuses when the carrier cannot afford the lift", () => {
    const carrier = testPlayer("alpha", { position: at(2, 2), stamina: LIFT_STAMINA_COST - 1 });
    const downed = testPlayer("beta", { position: at(2, 2, 0.6), health: 0 });
    const session = testSession([carrier, downed]);

    expect(liftPlayer(session, carrier.id, downed.id)).toEqual({
      ok: false,
      reason: "exhausted",
    });
    expect(downed.carriedByPlayerId).toBeNull();
  });

  it("resolves contention for the same downed player to exactly one carrier", () => {
    const first = testPlayer("alpha", { position: at(2, 2) });
    const second = testPlayer("gamma", { position: at(2, 2, -0.6) });
    const downed = testPlayer("beta", { position: at(2, 2, 0.6), health: 0 });
    const session = testSession([first, second, downed]);

    expect(liftPlayer(session, first.id, downed.id)).toEqual({ ok: true });
    expect(liftPlayer(session, second.id, downed.id)).toEqual({
      ok: false,
      reason: "notPermitted",
    });
    expect(downed.carriedByPlayerId).toBe(first.id);
    expect(second.carryingPlayerId).toBeNull();
  });

  it("refuses a carrier who is already carrying or being carried", () => {
    const carrier = testPlayer("alpha", { position: at(2, 2), carryingPlayerId: "existing" });
    const another = testPlayer("beta", { position: at(2, 2, 0.6), health: 0 });
    const session = testSession([carrier, another]);

    expect(liftPlayer(session, carrier.id, another.id)).toEqual({
      ok: false,
      reason: "notPermitted",
    });
  });

  it("refuses a downed player from lifting anyone", () => {
    const carrier = testPlayer("alpha", { position: at(2, 2), health: 0 });
    const target = testPlayer("beta", { position: at(2, 2, 0.6), health: 0 });
    const session = testSession([carrier, target]);

    expect(liftPlayer(session, carrier.id, target.id)).toEqual({
      ok: false,
      reason: "notPermitted",
    });
  });

  it("is refused within range but out of INTERACT_RANGE bounds precisely", () => {
    const carrier = testPlayer("alpha", { position: at(2, 2) });
    const downed = testPlayer("beta", {
      position: { x: at(2, 2).x + INTERACT_RANGE + 0.1, y: at(2, 2).y },
      health: 0,
    });
    const session = testSession([carrier, downed]);

    expect(liftPlayer(session, carrier.id, downed.id)).toEqual({
      ok: false,
      reason: "outOfRange",
    });
  });
});

describe("dropping a carry", () => {
  it("explicitly sets the target down where it stands", () => {
    const carrier = testPlayer("alpha", { position: at(2, 2), carryingPlayerId: "beta" });
    const downed = testPlayer("beta", {
      position: at(2, 2),
      health: 0,
      carriedByPlayerId: "alpha",
    });
    const session = testSession([carrier, downed]);

    expect(dropCarry(session, carrier.id)).toEqual({ ok: true });

    expect(carrier.carryingPlayerId).toBeNull();
    expect(downed.carriedByPlayerId).toBeNull();
    expect(downed.position).toEqual(at(2, 2));
  });

  it("refuses to drop when carrying nobody", () => {
    const carrier = testPlayer("alpha");
    const session = testSession([carrier]);

    expect(dropCarry(session, carrier.id)).toEqual({ ok: false, reason: "notPermitted" });
  });
});

describe("exhaustion drops a carry automatically", () => {
  it("sets the target down once the carrier cannot pay the continuous drain", () => {
    const carrier = testPlayer("alpha", {
      stamina: 1,
      carryingPlayerId: "beta",
    });
    const downed = testPlayer("beta", { health: 0, carriedByPlayerId: "alpha" });
    const session = testSession([carrier, downed]);

    advanceVitals(session, 1000, 1000);

    expect(carrier.stamina).toBe(0);
    expect(carrier.carryingPlayerId).toBeNull();
    expect(downed.carriedByPlayerId).toBeNull();
  });

  it("keeps the carry going while the drain is affordable net of regen", () => {
    const carrier = testPlayer("alpha", { stamina: 50, carryingPlayerId: "beta" });
    const downed = testPlayer("beta", { health: 0, carriedByPlayerId: "alpha" });
    const session = testSession([carrier, downed]);

    advanceVitals(session, 1000, 1000);

    expect(carrier.carryingPlayerId).toBe("beta");
    expect(downed.carriedByPlayerId).toBe("alpha");
    expect(carrier.stamina).toBe(50 - CARRY_STAMINA_DRAIN_PER_SECOND);
  });
});

describe("disconnect and extraction", () => {
  function hubParty(names: string[]) {
    let id = 0;
    const store = new SessionStore({
      dungeon: { dungeonId: "ember-vault" },
      createPlayerId: () => `player-${(id += 1)}`,
      createSessionId: () => `session-${(id += 1)}`,
      createResumeToken: () => `token-${(id += 1)}`,
      createRoomCode: () => "ROOM01",
    });
    const session = store.createSession();
    const players = names.map((playerName) => {
      const joined = store.join({
        roomCode: session.roomCode,
        playerName,
        profile: null,
        createProfile: () => ({
          id: `profile-${playerName}`,
          secretHash: "0".repeat(64),
          displayName: playerName,
          bankedItems: [],
          skillStacks: {},
          coin: 0,
          stats: { runsEscaped: 0, fullPartyEscapes: 0, wins: 0, emberWardenKills: 0, flawlessEmberWardenKills: 0, teammatesCarriedOut: 0, leverPuzzlesSolved: 0, runsWithoutTorch: 0, itemsBanked: 0, mothRoomsFound: 0 },
          earnedMilestones: [],
          ownedCosmeticIds: ["leather-cap", "traveler-cape"],
          equippedCosmetics: { hat: null, cloak: null, dye: null },
          runsEscaped: 0,
          runsLost: 0,
          createdAt: 0,
          lastSeenAt: 0,
          revision: 0,
        }),
      });
      if (!joined.ok) throw new Error(joined.message);
      return joined.player;
    });
    return { store, session, players };
  }

  it("drops whoever a disconnecting carrier was carrying", () => {
    const { store, players } = hubParty(["Alpha", "Beta"]);
    const [carrier, downed] = players;
    downed!.health = 0;
    carrier!.carryingPlayerId = downed!.id;
    downed!.carriedByPlayerId = carrier!.id;

    store.markDisconnected(carrier!.id);

    expect(carrier!.carryingPlayerId).toBeNull();
    expect(downed!.carriedByPlayerId).toBeNull();
  });

  it("clears both sides of a carry when either player leaves", () => {
    const { store, session, players } = hubParty(["Alpha", "Beta"]);
    const [carrier, downed] = players;
    downed!.health = 0;
    carrier!.carryingPlayerId = downed!.id;
    downed!.carriedByPlayerId = carrier!.id;

    store.leave(downed!.id);

    expect(session.players.has(downed!.id)).toBe(false);
    expect(carrier!.carryingPlayerId).toBeNull();
  });

  it("extracts a downed player who is carried through the exit as a survivor", () => {
    const standing = testPlayer("standing", { carryingPlayerId: "downed" });
    const downed = testPlayer("downed", { health: 0, carriedByPlayerId: "standing" });
    const session = testSession([standing, downed]);

    returnToHub(session, true);

    expect(downed.profile.runsEscaped).toBe(1);
    expect(downed.profile.runsLost).toBe(0);
  });

  it("still loses a downed player who was not being carried at extraction", () => {
    const standing = testPlayer("standing");
    const downed = testPlayer("downed", { health: 0 });
    const session = testSession([standing, downed]);

    returnToHub(session, true);

    expect(downed.profile.runsEscaped).toBe(0);
    expect(downed.profile.runsLost).toBe(1);
  });

  it("clears carry links on a world transition", () => {
    const standing = testPlayer("standing", { carryingPlayerId: "downed" });
    const downed = testPlayer("downed", { health: 0, carriedByPlayerId: "standing" });
    const session = testSession([standing, downed]);

    returnToHub(session, true);

    expect(standing.carryingPlayerId).toBeNull();
    expect(downed.carriedByPlayerId).toBeNull();
  });
});
