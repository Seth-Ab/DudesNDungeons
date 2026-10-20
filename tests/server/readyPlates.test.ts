import { describe, expect, it } from "vitest";
import { DEFAULT_APPEARANCE } from "../../src/shared/constants/appearance.js";
import { READY_PLATE_SIZE } from "../../src/shared/constants/game.js";
import { isFloor } from "../../src/shared/game/movement.js";
import { HUB_DUNGEON_ID } from "../../src/server/game/dungeonState.js";
import { pressReady, resolveReadyPlates } from "../../src/server/game/readyPlates.js";
import { partyReadyForRun, startRun } from "../../src/server/game/runLifecycle.js";
import { takeMapDiscovery } from "../../src/server/game/visibility.js";
import { SessionStore, toPlayerState, type Session } from "../../src/server/sessions/sessionStore.js";
import type { MapReadyPlate } from "../../src/shared/types/core.js";
import { at, joinRequest, testPlayer, testSession } from "./fixtures.js";

type Player = ReturnType<typeof testPlayer>;

function hubSession(names = ["ana", "bo"]) {
  const players = names.map((name) => testPlayer(name, { carryingTorch: false, position: at(11, 7) }));
  const session = testSession(players, HUB_DUNGEON_ID);
  session.location = "hub";
  return { session, players };
}

function plates(session: Session): MapReadyPlate[] {
  return session.dungeon.map.readyPlates ?? [];
}

function stepOnto(player: Player, plate: MapReadyPlate): void {
  player.position = { x: plate.x, y: plate.y };
}

/** Back onto the ring road by the fountain, well clear of every plate. */
function stepOff(player: Player): void {
  player.position = at(11, 4);
}

/** The ids of the players whose ready a tick changed. */
function tick(session: Session): string[] {
  return resolveReadyPlates(session).map((change) => change.player.id);
}

describe("hub ready plates", () => {
  it("places four plates on floor in a row in front of the gate, each with its own id", () => {
    const { session } = hubSession();
    const placed = plates(session);
    const exit = session.dungeon.exits[0]!;

    expect(placed).toHaveLength(4);
    expect(new Set(placed.map((plate) => plate.id)).size).toBe(4);
    expect(new Set(placed.map((plate) => plate.y)).size).toBe(1);
    const xs = placed.map((plate) => plate.x).sort((a, b) => a - b);
    // Centred on the gate, between the second and third plates.
    expect((xs[1]! + xs[2]!) / 2).toBe(exit.position.x);
    for (const plate of placed) {
      const half = READY_PLATE_SIZE / 2;
      for (const corner of [
        { x: plate.x - half, y: plate.y - half },
        { x: plate.x + half, y: plate.y + half },
      ]) {
        expect(isFloor(session.dungeon, corner), plate.id).toBe(true);
      }
      expect(plate.y).toBeGreaterThan(exit.position.y);
    }
  });

  it("sends plates with map discovery, once each", () => {
    const { session, players } = hubSession(["viewer"]);
    const viewer = players[0]!;
    viewer.discoveredTiles = new Uint8Array(session.dungeon.map.width * session.dungeon.map.height).fill(1);

    const first = takeMapDiscovery(session, viewer);
    expect(first.readyPlates?.map((plate) => plate.id).sort()).toEqual(
      plates(session).map((plate) => plate.id).sort(),
    );
    expect(takeMapDiscovery(session, viewer).readyPlates).toBeUndefined();
  });

  it("readies a player who steps onto a free plate, shows who holds it, and unreadies them when they step off", () => {
    const { session, players } = hubSession();
    const [ana] = players as [Player, Player];
    const plate = plates(session)[0]!;

    stepOnto(ana, plate);
    expect(tick(session)).toEqual(["ana"]);
    expect(ana.ready).toBe(true);
    expect(toPlayerState(ana, session).readyPlateId).toBe(plate.id);

    // Standing still changes nothing.
    expect(tick(session)).toEqual([]);

    stepOff(ana);
    expect(tick(session)).toEqual(["ana"]);
    expect(ana.ready).toBe(false);
    expect(ana.readyPlateId).toBeNull();
  });

  it("leaves a plate already held to its holder", () => {
    const { session, players } = hubSession();
    const [ana, bo] = players as [Player, Player];
    const plate = plates(session)[0]!;

    stepOnto(ana, plate);
    tick(session);
    stepOnto(bo, plate);
    expect(tick(session)).toEqual([]);
    expect(bo.ready).toBe(false);
    expect(bo.readyPlateId).toBeNull();

    // Once the holder leaves, the player still on it claims it in the same tick.
    stepOff(ana);
    expect(tick(session).sort()).toEqual(["ana", "bo"]);
    expect(bo.readyPlateId).toBe(plate.id);
    expect(bo.ready).toBe(true);
    expect(ana.ready).toBe(false);
  });

  it("lets a player hold only one plate at a time", () => {
    const { session, players } = hubSession(["ana"]);
    const ana = players[0]!;
    const [first, second] = plates(session) as [MapReadyPlate, MapReadyPlate];

    stepOnto(ana, first);
    tick(session);
    stepOnto(ana, second);
    tick(session);

    expect(ana.readyPlateId).toBe(second.id);
    expect(ana.ready).toBe(true);
    // The first is free again for anyone.
    const bo = testPlayer("bo", { position: { x: first.x, y: first.y } });
    session.players.set(bo.id, bo);
    tick(session);
    expect(bo.readyPlateId).toBe(first.id);
  });

  it("does not let a downed, carried, seated, disconnected or still-designing player claim a plate", () => {
    const { session, players } = hubSession(["down", "carried", "seated", "away", "designing"]);
    const [down, carried, seated, away, designing] = players as [Player, Player, Player, Player, Player];
    down.health = 0;
    carried.carriedByPlayerId = "down";
    seated.seatId = "14f4b265-75ae-41f0-81ba-f62410dcc5b3";
    away.connected = false;
    designing.appearance = null;
    plates(session).forEach((plate, index) => stepOnto(players[index]!, plate));
    designing.position = { x: plates(session)[0]!.x, y: plates(session)[0]!.y };

    expect(tick(session)).toEqual([]);
    for (const player of players) {
      expect(player.ready, player.id).toBe(false);
      expect(player.readyPlateId, player.id).toBeNull();
    }
  });

  it("does nothing outside the hub", () => {
    const { session, players } = hubSession(["ana"]);
    stepOnto(players[0]!, plates(session)[0]!);
    session.location = "dungeon";

    expect(tick(session)).toEqual([]);
    expect(players[0]!.ready).toBe(false);
  });
});

describe("the Ready button and plates", () => {
  it("unreadies a player standing on a plate, and the plate does not ready them again until they step off", () => {
    const { session, players } = hubSession(["ana"]);
    const ana = players[0]!;
    const plate = plates(session)[0]!;
    stepOnto(ana, plate);
    tick(session);

    pressReady(ana, false);
    expect(ana.ready).toBe(false);
    expect(ana.readyPlateId).toBeNull();
    expect(tick(session)).toEqual([]);
    expect(ana.ready).toBe(false);

    stepOff(ana);
    tick(session);
    stepOnto(ana, plate);
    expect(tick(session)).toEqual(["ana"]);
    expect(ana.ready).toBe(true);
  });

  it("readies a player who backed off a plate with the button, and lights the plate they stand on", () => {
    const { session, players } = hubSession(["ana"]);
    const ana = players[0]!;
    const plate = plates(session)[0]!;
    stepOnto(ana, plate);
    tick(session);
    pressReady(ana, false);
    tick(session);

    pressReady(ana, true);
    // Already ready, so claiming the plate changes nobody's ready.
    expect(tick(session)).toEqual([]);
    expect(ana.readyPlateId).toBe(plate.id);
    // And the ready is the button's, so stepping off keeps it.
    stepOff(ana);
    expect(tick(session)).toEqual([]);
    expect(ana.ready).toBe(true);
  });

  it("keeps ready set with the button when a player walks over a plate and off it", () => {
    const { session, players } = hubSession(["ana"]);
    const ana = players[0]!;
    pressReady(ana, true);

    stepOnto(ana, plates(session)[0]!);
    expect(tick(session)).toEqual([]);
    expect(ana.readyPlateId).toBe(plates(session)[0]!.id);
    stepOff(ana);
    expect(tick(session)).toEqual([]);
    expect(ana.ready).toBe(true);
    expect(ana.readyPlateId).toBeNull();
  });

  it("works without plates at all, and the gate asks only whether everyone is ready", () => {
    const { session, players } = hubSession();
    delete session.dungeon.map.readyPlates;

    for (const player of players) pressReady(player, true);
    expect(tick(session)).toEqual([]);
    expect(partyReadyForRun(session)).toBe(true);
    pressReady(players[0]!, false);
    expect(partyReadyForRun(session)).toBe(false);
  });
});

describe("filling the last plate", () => {
  it("cues the party on the change that made everyone ready", () => {
    const { session, players } = hubSession();
    const [ana, bo] = players as [Player, Player];
    const [first, second] = plates(session) as [MapReadyPlate, MapReadyPlate];

    stepOnto(ana, first);
    expect(resolveReadyPlates(session)).toEqual([{ player: ana, partyReady: false }]);
    stepOnto(bo, second);
    expect(resolveReadyPlates(session)).toEqual([{ player: bo, partyReady: true }]);
    expect(partyReadyForRun(session)).toBe(true);
  });

  it("does not cue when the button, not a plate, readies the last player", () => {
    const { session, players } = hubSession();
    const [ana, bo] = players as [Player, Player];
    stepOnto(ana, plates(session)[0]!);
    tick(session);

    pressReady(bo, true);
    expect(resolveReadyPlates(session)).toEqual([]);
    expect(partyReadyForRun(session)).toBe(true);
  });

  it("latches a party of one as soon as they step on, since they are the whole party", () => {
    const { session, players } = hubSession(["solo"]);
    const solo = players[0]!;
    stepOnto(solo, plates(session)[0]!);
    expect(resolveReadyPlates(session)).toEqual([{ player: solo, partyReady: true }]);

    stepOff(solo);
    expect(tick(session)).toEqual([]);
    expect(solo.ready).toBe(true);
  });

  it("keeps everyone ready once the party is, so a player can walk from their plate to the gate", () => {
    const { session, players } = hubSession();
    const [ana, bo] = players as [Player, Player];
    const [first, second] = plates(session) as [MapReadyPlate, MapReadyPlate];
    stepOnto(ana, first);
    tick(session);
    stepOnto(bo, second);
    tick(session);

    ana.position = { ...session.dungeon.exits[0]!.position };
    expect(tick(session)).toEqual([]);
    expect(ana.ready).toBe(true);
    expect(ana.readyPlateId).toBeNull();
    expect(partyReadyForRun(session)).toBe(true);
    expect(startRun(session, 0)).toEqual({ ok: true });
  });

  it("still lets a player back out with the button after the party is ready", () => {
    const { session, players } = hubSession();
    const [ana, bo] = players as [Player, Player];
    stepOnto(ana, plates(session)[0]!);
    stepOnto(bo, plates(session)[1]!);
    tick(session);

    pressReady(ana, false);
    expect(partyReadyForRun(session)).toBe(false);
    expect(tick(session)).toEqual([]);
    expect(ana.ready).toBe(false);
  });

  it("clears every plate when the run starts", () => {
    const { session, players } = hubSession();
    stepOnto(players[0]!, plates(session)[0]!);
    stepOnto(players[1]!, plates(session)[1]!);
    tick(session);

    expect(startRun(session, 0)).toEqual({ ok: true });
    for (const player of players) {
      expect(player.readyPlateId).toBeNull();
      expect(player.readyFromPlate).toBe(false);
      expect(player.ready).toBe(false);
    }
  });
});

describe("plates across a disconnect", () => {
  function joinedHub(clock: { now: number }) {
    const store = new SessionStore({ now: () => clock.now, reconnectGraceMs: 30_000 });
    const session = store.createSession();
    const joined = store.join(joinRequest({ roomCode: session.roomCode, playerName: "Grix" }));
    if (!joined.ok) throw new Error(joined.message);
    store.setAppearance(joined.player.id, DEFAULT_APPEARANCE);
    // A second member who stays off the plates, so the party is never all ready and nothing latches.
    const friend = store.join(joinRequest({ roomCode: session.roomCode, playerName: "Mira" }));
    if (!friend.ok) throw new Error(friend.message);
    store.setAppearance(friend.player.id, DEFAULT_APPEARANCE);
    stepOff(friend.player);
    return { store, session, player: joined.player };
  }

  it("frees the plate and takes back its ready on a drop, and a reconnect in the grace window claims it again", () => {
    const clock = { now: 0 };
    const { store, session, player } = joinedHub(clock);
    const plate = plates(session)[0]!;
    stepOnto(player, plate);
    tick(session);
    expect(player.ready).toBe(true);

    store.markDisconnected(player.id);
    expect(tick(session)).toEqual([player.id]);
    expect(player.ready).toBe(false);
    expect(player.readyPlateId).toBeNull();

    clock.now += 10_000;
    const resumed = store.join(
      joinRequest({ roomCode: session.roomCode, playerName: "Grix", resumeToken: player.resumeToken }),
    );
    expect(resumed.ok && resumed.resumed).toBe(true);
    expect(tick(session)).toEqual([player.id]);
    expect(player.readyPlateId).toBe(plate.id);
    expect(player.ready).toBe(true);
  });

  it("keeps button ready through a drop, as the grace rules always have", () => {
    const clock = { now: 0 };
    const { store, session, player } = joinedHub(clock);
    store.setReady(player.id, true);
    stepOnto(player, plates(session)[0]!);
    tick(session);

    store.markDisconnected(player.id);
    expect(tick(session)).toEqual([]);
    expect(player.ready).toBe(true);
    expect(player.readyPlateId).toBeNull();
  });

  it("frees the plate for good when the grace window runs out", () => {
    const clock = { now: 0 };
    const { store, session, player } = joinedHub(clock);
    const plate = plates(session)[0]!;
    stepOnto(player, plate);
    tick(session);
    store.markDisconnected(player.id);
    tick(session);

    clock.now += 30_000;
    expect(store.sweep().map((member) => member.player.id)).toEqual([player.id]);
    const next = testPlayer("next", { position: { x: plate.x, y: plate.y } });
    session.players.set(next.id, next);
    tick(session);
    expect(next.readyPlateId).toBe(plate.id);
  });
});
