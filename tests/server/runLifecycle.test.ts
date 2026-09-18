import { describe, expect, it } from "vitest";
import { pickupItem } from "../../src/server/game/items.js";
import {
  partyReadyForRun,
  partyWiped,
  returnToHub,
  startRun,
} from "../../src/server/game/runLifecycle.js";
import { SessionStore } from "../../src/server/sessions/sessionStore.js";
import type { InventoryItem } from "../../src/shared/types/core.js";
import { testPlayer, testSession } from "./fixtures.js";

const TONIC: InventoryItem = {
  id: "44444444-4444-4444-8444-444444444444",
  name: "Minor Tonic",
  kind: "tonic",
};

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
    const joined = store.join({ roomCode: session.roomCode, playerName });
    if (!joined.ok) throw new Error(joined.message);
    return joined.player;
  });
  return { session, players };
}

describe("starting a run", () => {
  it("requires every reserved party member to be connected and ready", () => {
    const { session, players } = hubParty(["Alpha", "Beta"]);
    players[0]!.ready = true;

    expect(partyReadyForRun(session)).toBe(false);
    expect(startRun(session, 100)).toEqual({ ok: false, reason: "notPermitted" });

    players[1]!.ready = true;
    players[1]!.connected = false;
    expect(partyReadyForRun(session)).toBe(false);

    players[1]!.connected = true;
    expect(partyReadyForRun(session)).toBe(true);
  });

  it("preserves only torches deliberately picked up before entering", () => {
    const { session, players } = hubParty(["Alpha", "Beta"]);
    const [torch] = session.dungeon.loot.filter((loot) => loot.kind === "torch");
    if (!torch) throw new Error("hub needs torch loot");

    players[0]!.position = { ...torch.position };
    expect(pickupItem(session, players[0]!.id, torch.id)).toEqual({ ok: true });
    expect(players[0]!.inventory).toEqual([]);
    expect(players[0]!.carryingTorch).toBe(true);
    expect(players[1]!.carryingTorch).toBe(false);

    for (const player of players) player.ready = true;
    expect(startRun(session, 500)).toEqual({ ok: true });

    expect(session.location).toBe("dungeon");
    expect(session.dungeon.map.id).toBe("ember-vault");
    expect(players[0]!.carryingTorch).toBe(true);
    expect(players[1]!.carryingTorch).toBe(false);
    expect(players.every((player) => !player.ready && player.enteredDungeonAt === 500)).toBe(true);
  });
});

describe("ending a run", () => {
  it("banks survivors' carry and takes a downed player's carry", () => {
    const standing = testPlayer("standing", { resistance: 7, inventory: [{ ...TONIC }] });
    const downed = testPlayer("downed", { health: 0, inventory: [{ ...TONIC }] });
    const session = testSession([standing, downed]);

    returnToHub(session, true);

    expect(session.location).toBe("hub");
    expect(session.dungeon.map.id).toBe("hub");
    expect(standing.bankedItems).toEqual([TONIC]);
    expect(downed.bankedItems).toEqual([]);
    expect(standing.inventory).toEqual([]);
    expect(downed.inventory).toEqual([]);
    expect(standing.carryingTorch).toBe(false);
    expect(standing.resistance).toBe(7);
    expect(downed.health).toBe(100);
  });

  it("recognizes a total party down and wipes every carried item", () => {
    const first = testPlayer("first", { health: 0, inventory: [{ ...TONIC }] });
    const second = testPlayer("second", { health: 0, inventory: [{ ...TONIC }] });
    const session = testSession([first, second]);

    expect(partyWiped(session)).toBe(true);
    returnToHub(session, false);

    expect(first.inventory).toEqual([]);
    expect(second.inventory).toEqual([]);
    expect(first.bankedItems).toEqual([]);
    expect(second.bankedItems).toEqual([]);
    expect(session.dungeon.loot.filter((loot) => loot.kind === "torch")).toHaveLength(4);
  });
});
