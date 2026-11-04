import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_APPEARANCE } from "../../src/shared/constants/appearance.js";
import { RUN_AUTOSAVE_INTERVAL_MS } from "../../src/shared/constants/game.js";
import { createGameServer, type GameServer } from "../../src/server/gameServer.js";
import { startRun } from "../../src/server/game/runLifecycle.js";
import { timeInDungeon } from "../../src/server/game/vitals.js";
import { createMemoryRoomSaveStorage, RoomSaveStore } from "../../src/server/saves/roomSaveStore.js";
import { SessionStore, type JoinResult, type SessionPlayer } from "../../src/server/sessions/sessionStore.js";
import { createMemoryVaultStorage, VaultStore } from "../../src/server/vaults/vaultStore.js";
import { joinRequest, testProfile } from "./fixtures.js";

const ROOM = "BCDFGH";
const TRAP_ID = "77777777-7777-4777-8777-777777777777";

const roomStorage = createMemoryRoomSaveStorage();
const vaultStorage = createMemoryVaultStorage();
const servers: GameServer[] = [];

/**
 * A server wired the way `src/server/index.ts` wires it: the store and the game server both take
 * their default clocks. Nothing here injects `now`, so a clock mismatch between them shows up.
 */
function boot(): { server: GameServer; store: SessionStore; saves: RoomSaveStore } {
  const saves = new RoomSaveStore(roomStorage);
  const store = new SessionStore({
    dungeon: { dungeonId: "ember-vault" },
    createRoomCode: () => ROOM,
    vaults: new VaultStore(vaultStorage),
    saves,
  });
  const server = createGameServer({ store, log: false });
  servers.push(server);
  return { server, store, saves };
}

function profileId(index: number): string {
  return `${String(index + 1).padStart(8, "0")}-0000-4000-8000-000000000000`;
}

function join(store: SessionStore, name: string, index: number, savedRun?: "continue"): SessionPlayer {
  const result: JoinResult = store.join(
    joinRequest({
      roomCode: ROOM,
      playerName: name,
      createProfile: () => testProfile(name, { id: profileId(index) }),
      profile: testProfile(name, { id: profileId(index) }),
      ...(savedRun === undefined ? {} : { savedRun }),
    }),
  );
  if (!result.ok) throw new Error(`${name}: ${result.code}`);
  store.setAppearance(result.player.id, DEFAULT_APPEARANCE);
  return result.player;
}

beforeEach(() => {
  // The tick and autosave intervals, and the monotonic clock `performance.now()` they read.
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
});

afterEach(async () => {
  vi.useRealTimers();
  for (const server of servers.splice(0)) await server.close();
});

describe("continuing a saved run with default clock wiring", () => {
  it("keeps the run's timers counting after a restart, for the first and a second player", async () => {
    const first = boot();
    const session = first.store.createSession();
    const alpha = join(first.store, "Alpha", 0);
    join(first.store, "Beta", 1);
    for (const player of session.players.values()) player.ready = true;
    expect(startRun(session, performance.now())).toEqual({ ok: true });
    const monster = session.dungeon.monsters[0]!;
    session.monsterCooldowns.set(monster.id, performance.now() + RUN_AUTOSAVE_INTERVAL_MS + 4_000);
    session.trapRearmAt.set(TRAP_ID, performance.now() + RUN_AUTOSAVE_INTERVAL_MS + 9_000);

    vi.advanceTimersByTime(RUN_AUTOSAVE_INTERVAL_MS);
    const savedElapsed = timeInDungeon(alpha, performance.now());
    expect(first.saves.get(ROOM)?.run?.players).toHaveLength(2);
    first.saves.flush();
    first.store.vaults.flush();
    await first.server.close();

    // A restart: only the files carry over, and the new process has a different monotonic reading.
    vi.advanceTimersByTime(60_000);
    const second = boot();
    const continued = join(second.store, "Alpha", 0, "continue");
    const restored = second.store.getSession(ROOM)!;
    const startedAt = performance.now();
    expect(timeInDungeon(continued, startedAt)).toBe(savedElapsed);
    const cooldownAt = restored.monsterCooldowns.get(monster.id)!;
    const rearmAt = restored.trapRearmAt.get(TRAP_ID)!;
    expect(cooldownAt).toBe(startedAt + 4_000);
    expect(rearmAt).toBe(startedAt + 9_000);

    vi.advanceTimersByTime(10_000);
    expect(timeInDungeon(continued, performance.now())).toBe(savedElapsed + 10_000);
    expect(performance.now()).toBeGreaterThanOrEqual(cooldownAt);
    expect(performance.now()).toBeGreaterThanOrEqual(rearmAt);

    // The autosave on its interval records the elapsed time instead of overwriting it with zero.
    vi.advanceTimersByTime(RUN_AUTOSAVE_INTERVAL_MS);
    const entry = second.saves.get(ROOM)?.run?.players.find((candidate) => candidate.profileId === profileId(0));
    expect(entry?.runElapsedMs).toBe(savedElapsed + RUN_AUTOSAVE_INTERVAL_MS);

    // A second member rejoining the continued run gets their own elapsed time on the same clock.
    const beta = join(second.store, "Beta", 1, "continue");
    expect(timeInDungeon(beta, performance.now())).toBe(savedElapsed);
    vi.advanceTimersByTime(5_000);
    expect(timeInDungeon(beta, performance.now())).toBe(savedElapsed + 5_000);
  });
});
