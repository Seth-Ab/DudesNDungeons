import { describe, expect, it } from "vitest";
import { advanceCamps } from "../../src/server/game/camps.js";
import { simulate } from "../../src/server/game/combat.js";
import { buildDungeon } from "../../src/server/game/dungeonState.js";
import { interact } from "../../src/server/game/items.js";
import { lootRngFor } from "../../src/server/game/monsterLoot.js";
import { standUp } from "../../src/server/game/seats.js";
import { advanceVitals } from "../../src/server/game/vitals.js";
import type {
  Session,
  SessionPlayer,
} from "../../src/server/sessions/sessionStore.js";
import {
  CAMP_REST_RESISTANCE,
  CAMP_REST_SEATED_MS,
  RESISTANCE_DECAY_GRACE_MS,
} from "../../src/shared/constants/game.js";
import { SEAT_FACING_VECTORS } from "../../src/shared/constants/scenery.js";
import { isFloor, tileOf } from "../../src/shared/game/movement.js";
import { roomAt } from "../../src/shared/game/rooms.js";
import { testPlayer, testSession } from "./fixtures.js";

const NAMES = ["alpha", "bravo", "charlie"];

/** A generated `vault-run` with a camp in it, party-sized, with everyone placed on its floor. */
function campRun(
  names = NAMES,
  seed = 1,
): { session: Session; players: SessionPlayer[]; campId: string } {
  for (let attempt = seed; attempt < seed + 200; attempt += 1) {
    const request = {
      dungeonId: "vault-run",
      seed: attempt,
      partySize: names.length,
    };
    const built = buildDungeon(request);
    const camp = built.dungeon.rooms.find((room) => room.kind === "camp");
    if (!camp) continue;

    const players = names.map((name) => testPlayer(name));
    const session = testSession(players, "vault-run");
    session.dungeon = built.dungeon;
    session.runDungeon = request;
    session.lootRng = lootRngFor(built.seed, "vault-run");
    for (const player of players) player.enteredDungeonAt = 0;
    return { session, players, campId: camp.id };
  }
  throw new Error("No seed in range generated a camp");
}

function campSeats(session: Session, campId: string) {
  const camp = session.dungeon.rooms.find((room) => room.id === campId)!;
  return (session.dungeon.map.seats ?? []).filter(
    (seat) => roomAt([camp], seat) !== null,
  );
}

function sit(session: Session, player: SessionPlayer, seatId: string): void {
  const seat = session.dungeon.map.seats!.find(
    (candidate) => candidate.id === seatId,
  )!;
  player.position = { x: seat.x, y: seat.y };
  expect(interact(session, player.id, seatId)).toEqual({ ok: true });
}

/** Seats every player, in order, at the camp's seats. */
function seatAll(
  session: Session,
  players: SessionPlayer[],
  campId: string,
): void {
  const seats = campSeats(session, campId);
  players.forEach((player, index) => sit(session, player, seats[index]!.id));
}

describe("camp rooms", () => {
  it("light a campfire and seat four round it, each facing the fire and on floor", () => {
    const { session, campId } = campRun();
    const seats = campSeats(session, campId);
    const camp = session.dungeon.rooms.find((room) => room.id === campId)!;
    const fires = session.dungeon.lightSources.filter(
      (light) =>
        light.fixture === "campfire" && roomAt([camp], light.position) !== null,
    );

    expect(fires).toHaveLength(1);
    expect(seats).toHaveLength(4);
    for (const seat of seats) {
      expect(isFloor(session.dungeon, seat)).toBe(true);
      // The seat faces the fire: a step that way gets closer to it.
      const toward = SEAT_FACING_VECTORS[seat.facing];
      const fire = fires[0]!.position;
      const before = Math.hypot(seat.x - fire.x, seat.y - fire.y);
      const after = Math.hypot(
        seat.x + toward.x - fire.x,
        seat.y + toward.y - fire.y,
      );
      expect(after).toBeLessThan(before);
      expect(tileOf(seat)).not.toEqual(tileOf(fire));
    }
  });

  it("put no seats in rooms that are not camps", () => {
    const { session } = campRun();
    const camps = session.dungeon.rooms.filter((room) => room.kind === "camp");
    for (const seat of session.dungeon.map.seats ?? []) {
      expect(camps.some((camp) => roomAt([camp], seat) !== null)).toBe(true);
    }
  });
});

describe("Campfire Rest", () => {
  it("restores resistance to everyone once they have all sat for the full time", () => {
    const { session, players, campId } = campRun();
    seatAll(session, players, campId);
    const before = players.map((player) => player.resistance);

    advanceCamps(session, 1000);
    advanceCamps(session, 1000 + CAMP_REST_SEATED_MS - 1);
    expect(players.map((player) => player.resistance)).toEqual(before);

    advanceCamps(session, 1000 + CAMP_REST_SEATED_MS);
    expect(players.map((player) => player.resistance)).toEqual(
      before.map((value) => value + CAMP_REST_RESISTANCE),
    );
  });

  it("does not heal", () => {
    const { session, players, campId } = campRun();
    players[0]!.health = 40;
    seatAll(session, players, campId);
    advanceCamps(session, 0);
    advanceCamps(session, CAMP_REST_SEATED_MS);

    expect(players[0]!.health).toBe(40);
  });

  it("waits while anyone is still standing, and restarts when someone stands up", () => {
    const { session, players, campId } = campRun();
    const seats = campSeats(session, campId);
    sit(session, players[0]!, seats[0]!.id);
    sit(session, players[1]!, seats[1]!.id);

    advanceCamps(session, 0);
    advanceCamps(session, CAMP_REST_SEATED_MS * 2);
    expect(players[0]!.resistance).toBe(players[0]!.resistance);
    expect(session.campsRested.size).toBe(0);

    sit(session, players[2]!, seats[2]!.id);
    advanceCamps(session, CAMP_REST_SEATED_MS * 2 + 1);
    advanceCamps(session, CAMP_REST_SEATED_MS * 3);
    standUp(session, players[1]!);
    advanceCamps(session, CAMP_REST_SEATED_MS * 3 + 1);
    // Sitting again starts a fresh count rather than resuming the old one.
    sit(session, players[1]!, seats[1]!.id);
    advanceCamps(session, CAMP_REST_SEATED_MS * 3 + 2);
    advanceCamps(session, CAMP_REST_SEATED_MS * 4);
    expect(session.campsRested.size).toBe(0);
    advanceCamps(session, CAMP_REST_SEATED_MS * 3 + 2 + CAMP_REST_SEATED_MS);
    expect(session.campsRested.size).toBe(1);
  });

  it("resets when a seated player disconnects, and does not wait on them afterwards", () => {
    const { session, players, campId } = campRun();
    seatAll(session, players, campId);
    advanceCamps(session, 0);
    advanceCamps(session, CAMP_REST_SEATED_MS - 1);

    players[2]!.connected = false;
    standUp(session, players[2]!);
    const restedBefore = players[0]!.resistance;
    advanceCamps(session, CAMP_REST_SEATED_MS);
    // Two connected players remain seated, but the clock restarts at the disconnect.
    expect(players[0]!.resistance).toBe(restedBefore);
    advanceCamps(session, CAMP_REST_SEATED_MS * 2);
    expect(players[0]!.resistance).toBe(restedBefore + CAMP_REST_RESISTANCE);
    expect(players[1]!.resistance).toBe(restedBefore + CAMP_REST_RESISTANCE);
    // The one who left is not rested.
    expect(players[2]!.resistance).toBe(restedBefore);
  });

  it("never counts a downed player, neither waiting on them nor restoring them", () => {
    const { session, players, campId } = campRun();
    const seats = campSeats(session, campId);
    sit(session, players[0]!, seats[0]!.id);
    sit(session, players[1]!, seats[1]!.id);
    players[2]!.health = 0;
    const downedBefore = players[2]!.resistance;

    advanceCamps(session, 0);
    advanceCamps(session, CAMP_REST_SEATED_MS);

    expect(players[0]!.resistance).toBe(players[0]!.resistance);
    expect(session.campsRested.size).toBe(1);
    expect(players[2]!.resistance).toBe(downedBefore);
  });

  it("does nothing while every player is down, rather than resting no one", () => {
    const { session, players } = campRun();
    for (const player of players) player.health = 0;
    advanceCamps(session, 0);
    advanceCamps(session, CAMP_REST_SEATED_MS * 2);
    expect(session.campsRested.size).toBe(0);
  });

  it("does not count players who have not designed a look yet", () => {
    const { session, players, campId } = campRun();
    const lurker = testPlayer("lurker", { appearance: null });
    session.players.set(lurker.id, lurker);
    seatAll(session, players, campId);

    advanceCamps(session, 0);
    advanceCamps(session, CAMP_REST_SEATED_MS);
    expect(session.campsRested.size).toBe(1);
  });

  it("rests a camp once only: a second sit does nothing", () => {
    const { session, players, campId } = campRun();
    seatAll(session, players, campId);
    advanceCamps(session, 0);
    advanceCamps(session, CAMP_REST_SEATED_MS);
    const rested = players.map((player) => player.resistance);

    for (const player of players) standUp(session, player);
    seatAll(session, players, campId);
    advanceCamps(session, CAMP_REST_SEATED_MS + 1);
    advanceCamps(session, CAMP_REST_SEATED_MS * 4);

    expect(players.map((player) => player.resistance)).toEqual(rested);
  });

  it("caps at the player's resistance limit", () => {
    const { session, players, campId } = campRun();
    players[0]!.resistance = 95;
    seatAll(session, players, campId);
    advanceCamps(session, 0);
    advanceCamps(session, CAMP_REST_SEATED_MS);

    expect(players[0]!.resistance).toBe(100);
  });

  it("does not run in the hub", () => {
    const { session, players, campId } = campRun();
    seatAll(session, players, campId);
    session.location = "hub";
    advanceCamps(session, 0);
    advanceCamps(session, CAMP_REST_SEATED_MS);
    expect(session.campsRested.size).toBe(0);
  });

  it("runs from the simulation tick", () => {
    const { session, players, campId } = campRun();
    // Clear monsters so the tick is only about the camp.
    session.dungeon.monsters = [];
    seatAll(session, players, campId);
    simulate(session, 0);
    simulate(session, 100);
    expect(session.campSeatedSince.size).toBe(1);
  });
});

describe("resistance decay and seats", () => {
  it("pauses while seated and resumes the moment they stand", () => {
    const { session, players, campId } = campRun();
    const seats = campSeats(session, campId);
    const [seated, standing] = players as [SessionPlayer, SessionPlayer];
    sit(session, seated, seats[0]!.id);
    const start = seated.resistance;
    const now = RESISTANCE_DECAY_GRACE_MS + 10_000;

    advanceVitals(session, now, 10_000);
    expect(seated.resistance).toBe(start);
    expect(standing.resistance).toBeLessThan(start);

    standUp(session, seated);
    advanceVitals(session, now + 10_000, 10_000);
    expect(seated.resistance).toBeLessThan(start);
  });
});
