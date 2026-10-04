import { describe, expect, it } from "vitest";
import { bossesRemain } from "../../src/server/game/bosses.js";
import { resolvePlayerAttack } from "../../src/server/game/combat.js";
import { buildDungeon } from "../../src/server/game/dungeonState.js";
import { interact } from "../../src/server/game/items.js";
import { partyWiped, returnToHub, startRun } from "../../src/server/game/runLifecycle.js";
import { visibilityFrameForPlayer } from "../../src/server/game/visibility.js";
import { SessionStore, type Session } from "../../src/server/sessions/sessionStore.js";
import { PLAYER_ATTACK_DAMAGE } from "../../src/shared/constants/game.js";
import type { InventoryItem, MonsterState, RoomState } from "../../src/shared/types/core.js";
import { TEST_SEED, joinRequest, testPlayer, testSession } from "./fixtures.js";

/**
 * The generated Vault Run always has one boss slot, filled by the Warden Crucible and its Ember
 * Warden. These tests play it from the pinned seed so the boss and the exit are where they were.
 */
const RUN_ID = "vault-run";

const TONIC: InventoryItem = {
  id: "44444444-4444-4444-8444-444444444444",
  name: "Minor Tonic",
  kind: "tonic",
};

function bossOf(session: Session): MonsterState {
  const boss = session.dungeon.monsters.find((monster) => monster.boss);
  if (!boss) throw new Error("No boss in this dungeon");
  return boss;
}

function exitOf(session: Session) {
  const exit = session.dungeon.exits[0];
  if (!exit) throw new Error("No exit in this dungeon");
  return exit;
}

function contains(room: RoomState, position: { x: number; y: number }): boolean {
  return (
    position.x >= room.x &&
    position.x < room.x + room.width &&
    position.y >= room.y &&
    position.y < room.y + room.height
  );
}

/** Stands the player right beside the boss with it one swing from falling, and swings. */
function slayBoss(session: Session, playerId: string, now = 0) {
  const boss = bossOf(session);
  const player = session.players.get(playerId)!;
  player.position = { x: boss.position.x - 1, y: boss.position.y };
  boss.health = PLAYER_ATTACK_DAMAGE;
  return resolvePlayerAttack(session, playerId, { x: 1, y: 0 }, boss.id, now);
}

describe("boss placement", () => {
  it("spawns exactly one boss, inside the boss room, across many seeds", () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      const { dungeon } = buildDungeon({ dungeonId: RUN_ID, seed });
      const bosses = dungeon.monsters.filter((monster) => monster.boss);
      const bossRoom = dungeon.rooms.find((room) => room.kind === "boss");

      expect(bosses, `seed ${seed}`).toHaveLength(1);
      expect(bosses[0]?.typeId).toBe("ember-warden");
      expect(contains(bossRoom!, bosses[0]!.position), `seed ${seed}`).toBe(true);
    }
  });

  it("marks only boss content as a boss, and seals the exit from the start", () => {
    const { dungeon } = buildDungeon({ dungeonId: RUN_ID, seed: TEST_SEED });

    for (const monster of dungeon.monsters) {
      expect(monster.boss).toBe(monster.typeId === "ember-warden");
    }
    expect(dungeon.exits.every((exit) => exit.sealed)).toBe(true);
  });

  it("leaves exits open in a world with no boss", () => {
    expect(buildDungeon({ dungeonId: "hub" }).dungeon.exits.every((exit) => !exit.sealed)).toBe(true);
    expect(buildDungeon({ dungeonId: "ember-vault" }).dungeon.exits.every((exit) => !exit.sealed)).toBe(
      true,
    );
  });
});

describe("escaping past a boss", () => {
  it("refuses the exit while the boss lives, changing nothing", () => {
    const player = testPlayer("alpha", { inventory: [TONIC] });
    const session = testSession([player], RUN_ID);
    const exit = exitOf(session);
    player.position = { ...exit.position };

    expect(interact(session, "alpha", exit.id)).toEqual({ ok: false, reason: "notPermitted" });
    expect(session.location).toBe("dungeon");
    expect(player.inventory).toEqual([TONIC]);
    expect(player.profile.bankedItems).toEqual([]);
    expect(player.profile.runsEscaped).toBe(0);
  });

  it("still refuses with the boss wounded but standing", () => {
    const player = testPlayer("alpha");
    const session = testSession([player], RUN_ID);
    const boss = bossOf(session);
    player.position = { x: boss.position.x - 1, y: boss.position.y };

    const swing = resolvePlayerAttack(session, "alpha", { x: 1, y: 0 }, boss.id, 0);
    expect(swing.ok && swing.event.targetDefeated).toBe(false);
    expect(boss.health).toBe(boss.maxHealth - PLAYER_ATTACK_DAMAGE);
    expect(exitOf(session).sealed).toBe(true);
  });

  it("unseals the exit when the boss falls, and then lets the party out with its loot", () => {
    const player = testPlayer("alpha", { inventory: [TONIC] });
    const session = testSession([player], RUN_ID);

    const swing = slayBoss(session, "alpha");
    expect(swing.ok && swing.event.targetDefeated).toBe(true);
    expect(bossOf(session).alive).toBe(false);
    expect(bossesRemain(session.dungeon)).toBe(false);
    expect(exitOf(session).sealed).toBe(false);

    const exit = exitOf(session);
    player.position = { ...exit.position };
    expect(interact(session, "alpha", exit.id)).toEqual({ ok: true });
    expect(session.location).toBe("hub");
    expect(player.profile.bankedItems).toEqual([TONIC]);
    expect(player.profile.runsEscaped).toBe(1);
  });

  it("does not unseal for an ordinary monster falling", () => {
    const player = testPlayer("alpha");
    const session = testSession([player], RUN_ID);
    const minion = session.dungeon.monsters.find((monster) => !monster.boss)!;
    player.position = { x: minion.position.x - 1, y: minion.position.y };
    minion.health = PLAYER_ATTACK_DAMAGE;

    const swing = resolvePlayerAttack(session, "alpha", { x: 1, y: 0 }, minion.id, 0);
    expect(swing.ok && swing.event.targetDefeated).toBe(true);
    expect(exitOf(session).sealed).toBe(true);
  });
});

describe("a wipe at the boss", () => {
  it("returns the party with nothing, and the next run has a fresh boss sealing its exit", () => {
    const alpha = testPlayer("alpha", { inventory: [TONIC], ready: true });
    const beta = testPlayer("beta", { ready: true });
    const session = testSession([alpha, beta], RUN_ID);

    alpha.health = 0;
    beta.health = 0;
    expect(partyWiped(session)).toBe(true);
    returnToHub(session, false);

    expect(session.location).toBe("hub");
    expect(alpha.profile.bankedItems).toEqual([]);
    expect(alpha.profile.runsLost).toBe(1);

    alpha.ready = true;
    beta.ready = true;
    expect(startRun(session, 0)).toEqual({ ok: true });
    expect(bossOf(session).alive).toBe(true);
    expect(bossOf(session).health).toBe(bossOf(session).maxHealth);
    expect(exitOf(session).sealed).toBe(true);
  });

  it("does not carry a defeated boss into the next run", () => {
    const player = testPlayer("alpha", { ready: true });
    const session = testSession([player], RUN_ID);
    slayBoss(session, "alpha");
    const exit = exitOf(session);
    player.position = { ...exit.position };
    expect(interact(session, "alpha", exit.id)).toEqual({ ok: true });

    player.ready = true;
    expect(startRun(session, 0)).toEqual({ ok: true });
    expect(exitOf(session).sealed).toBe(true);
  });
});

describe("reconnecting mid-run", () => {
  it("keeps the boss defeated and the exit open for a player who drops and comes back", () => {
    let clock = 0;
    let counter = 0;
    const store = new SessionStore({
      now: () => clock,
      createPlayerId: () => `player-${(counter += 1)}`,
      createSessionId: () => `session-${(counter += 1)}`,
      createResumeToken: () => `token-${(counter += 1)}`,
      createRoomCode: () => `ROOM${(counter += 1)}`,
      reconnectGraceMs: 60_000,
      emptySessionTtlMs: 600_000,
      dungeon: { dungeonId: RUN_ID, seed: TEST_SEED },
    });
    const session = store.createSession();
    const joined = store.join(joinRequest({ roomCode: session.roomCode, playerName: "Grix" }));
    if (!joined.ok) throw new Error("join failed");
    const { player } = joined;
    player.ready = true;
    expect(startRun(session, 0)).toEqual({ ok: true });

    expect(slayBoss(session, player.id).ok).toBe(true);
    store.markDisconnected(player.id);
    clock += 30_000;

    const resumed = store.join(
      joinRequest({
        roomCode: session.roomCode,
        playerName: "Grix",
        resumeToken: player.resumeToken,
      }),
    );
    expect(resumed.ok && resumed.resumed).toBe(true);
    expect(session.location).toBe("dungeon");
    expect(bossOf(session).alive).toBe(false);
    expect(exitOf(session).sealed).toBe(false);

    const exit = exitOf(session);
    player.position = { ...exit.position };
    expect(interact(session, player.id, exit.id)).toEqual({ ok: true });
    expect(session.location).toBe("hub");
  });
});

describe("what a client learns about the boss", () => {
  it("sends neither the boss nor its room to a player who has not seen them", () => {
    const player = testPlayer("alpha");
    const session = testSession([player], RUN_ID);
    player.position = { ...session.spawnPoints[0]! };

    const frame = visibilityFrameForPlayer(session, player);
    const bossRoom = session.dungeon.rooms.find((room) => room.kind === "boss")!;

    expect(frame.dungeon.monsters.some((monster) => monster.boss)).toBe(false);
    expect(frame.dungeon.rooms.map((room) => room.id)).not.toContain(bossRoom.id);
    expect(frame.dungeon.exits).toEqual([]);
    expect(JSON.stringify(frame)).not.toContain(bossOf(session).id);
  });

  it("sends the boss, flagged, once it is in sight", () => {
    const player = testPlayer("alpha");
    const session = testSession([player], RUN_ID);
    const boss = bossOf(session);
    player.position = { x: boss.position.x - 1, y: boss.position.y };

    const seen = visibilityFrameForPlayer(session, player).dungeon.monsters.find(
      (monster) => monster.id === boss.id,
    );
    expect(seen).toMatchObject({ boss: true, health: boss.maxHealth, alive: true });
  });

  it("shows a seen exit as sealed until the boss falls, then open", () => {
    const player = testPlayer("alpha");
    const session = testSession([player], RUN_ID);
    const exit = exitOf(session);
    player.position = { ...exit.position };

    expect(visibilityFrameForPlayer(session, player).dungeon.exits).toMatchObject([
      { id: exit.id, sealed: true },
    ]);

    expect(slayBoss(session, "alpha").ok).toBe(true);
    player.position = { ...exit.position };

    expect(visibilityFrameForPlayer(session, player).dungeon.exits).toMatchObject([
      { id: exit.id, sealed: false },
    ]);
  });
});
