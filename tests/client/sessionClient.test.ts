import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGameServer, type GameServer } from "../../src/server/gameServer.js";
import { markProfileChanged } from "../../src/server/profiles/profile.js";
import {
  createMemoryProfileStorage,
  ProfileStore,
  type ProfileStorage,
} from "../../src/server/profiles/profileStore.js";
import { SessionStore } from "../../src/server/sessions/sessionStore.js";
import {
  createMemoryProfileSecretStore,
  createMemoryTokenStore,
} from "../../src/client/network/endpoints.js";
import {
  createSessionClient,
  type ProfileSecretStore,
  type SessionClient,
} from "../../src/client/network/sessionClient.js";
import type { SessionView } from "../../src/client/network/sessionState.js";

/**
 * Drives the real client against the real server. Node supplies global `WebSocket` and `fetch`, so
 * the only thing missing versus a browser is the DOM, which the networking layer does not touch.
 */

const GRACE_MS = 300;

let server: GameServer;
let httpUrl: string;
let wsUrl: string;
const clients: SessionClient[] = [];

/**
 * A fresh client, which is a fresh device unless it is handed a secret store to share: two clients
 * with their own stores are two players, and two clients over one store are one player twice.
 */
function newClient(
  retryDelaysMs = [20, 40, 80],
  profileSecretStore: ProfileSecretStore = createMemoryProfileSecretStore(),
): SessionClient {
  const client = createSessionClient({
    httpUrl,
    wsUrl,
    tokenStore: createMemoryTokenStore(),
    profileSecretStore,
    retryDelaysMs,
  });
  clients.push(client);
  return client;
}

/** Resolves once the client's view satisfies `predicate`, or fails with the last view seen. */
function until(
  client: SessionClient,
  predicate: (view: SessionView) => boolean,
  timeoutMs = 4000,
): Promise<SessionView> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const stop = client.subscribe((view) => {
      if (settled || !predicate(view)) return;
      settled = true;
      setTimeout(() => stop(), 0);
      resolve(view);
    });
    setTimeout(() => {
      if (settled) return;
      settled = true;
      stop();
      reject(new Error(`timed out; last view was ${JSON.stringify(client.view)}`));
    }, timeoutMs);
  });
}

const inSession = (view: SessionView): boolean => view.phase === "inSession";

/**
 * Resolves once the server satisfies `predicate`. For the cases with nothing on the wire to wait
 * for, such as a departure nobody else is in the room to notice.
 */
function untilServer(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = (): void => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() > deadline) {
        reject(new Error("timed out waiting on the server"));
        return;
      }
      setTimeout(poll, 10);
    };
    poll();
  });
}

beforeEach(async () => {
  server = createGameServer({
    // The authored dungeon, so the assertions below can name a map and known entity positions.
    store: new SessionStore({ reconnectGraceMs: GRACE_MS, dungeon: { dungeonId: "ember-vault" } }),
    tickIntervalMs: 20,
    sweepIntervalMs: 20,
    log: false,
  });
  const address = await server.listen(0, "127.0.0.1");
  httpUrl = `http://127.0.0.1:${address.port}`;
  wsUrl = `ws://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  for (const client of clients.splice(0)) client.disconnect();
  await server.close();
});

describe("creating and joining", () => {
  it("creates a room and joins it", async () => {
    const client = newClient();
    const roomCode = await client.createRoom();
    expect(roomCode).toMatch(/^[BCDFGHJKLMNPQRSTVWXYZ23456789]{6}$/);

    client.join(roomCode, "Alpha");
    const view = await until(client, inSession);

    expect(view.roomCode).toBe(roomCode);
    expect(view.selfId).not.toBeNull();
    expect(view.tickRate).toBe(20);
    expect(view.players).toHaveLength(1);
  });

  it("moves through connecting and joining on the way in", async () => {
    const client = newClient();
    const roomCode = await client.createRoom();

    const seen: string[] = [];
    client.subscribe((view) => {
      if (seen[seen.length - 1] !== view.phase) seen.push(view.phase);
    });

    client.join(roomCode, "Alpha");
    await until(client, inSession);

    expect(seen[0]).toBe("offline");
    expect(seen).toContain("joining");
    expect(seen[seen.length - 1]).toBe("inSession");
  });

  it("reports an unknown room code without wedging the client", async () => {
    const client = newClient();
    client.join("ZZZZZZ", "Alpha");

    const view = await until(client, (v) => v.lastError?.code === "sessionNotFound");
    expect(view.phase).toBe("connected");

    // The same socket must still work for a corrected code.
    const roomCode = await client.createRoom();
    client.join(roomCode, "Alpha");
    await until(client, inSession);
  });

  it("sees other players arrive and leave", async () => {
    const host = newClient();
    const roomCode = await host.createRoom();
    host.join(roomCode, "Alpha");
    await until(host, inSession);

    const guest = newClient();
    guest.join(roomCode, "Beta");
    await until(guest, inSession);

    await until(host, (view) => view.players.length === 2);

    guest.leave();
    const after = await until(host, (view) => view.players.length === 1);
    expect(after.players[0]?.name).toBe("Alpha");
  });

  it("refuses a fifth player", async () => {
    const host = newClient();
    const roomCode = await host.createRoom();
    host.join(roomCode, "One");
    await until(host, inSession);

    for (const name of ["Two", "Three", "Four"]) {
      const member = newClient();
      member.join(roomCode, name);
      await until(member, inSession);
    }

    const fifth = newClient();
    fifth.join(roomCode, "Five");
    const view = await until(fifth, (v) => v.lastError !== null);
    expect(view.lastError?.code).toBe("sessionFull");
  });
});

describe("ready state", () => {
  it("propagates a ready toggle to the other player", async () => {
    const host = newClient();
    const roomCode = await host.createRoom();
    host.join(roomCode, "Alpha");
    await until(host, inSession);

    const guest = newClient();
    guest.join(roomCode, "Beta");
    const guestView = await until(guest, inSession);

    host.setReady(true);
    const view = await until(guest, (v) =>
      v.players.some((p) => p.id !== guestView.selfId && p.ready),
    );
    expect(view.players.find((p) => p.ready)?.name).toBe("Alpha");
  });
});

describe("snapshots", () => {
  it("keeps receiving authoritative snapshots after joining", async () => {
    const client = newClient();
    const roomCode = await client.createRoom();
    client.join(roomCode, "Alpha");
    await until(client, inSession);

    const view = await until(client, (v) => v.tick > 0);
    expect(view.players).toHaveLength(1);
    expect(view.location).toBe("hub");
    expect(view.dungeon?.map.id).toBe("hub");
  });

  it("never exposes a resume token through the session view", async () => {
    const client = newClient();
    const roomCode = await client.createRoom();
    client.join(roomCode, "Alpha");
    await until(client, (v) => v.tick > 0);

    expect(JSON.stringify(client.view)).not.toMatch(/[0-9a-f]{32}/);
  });
});

describe("movement intent", () => {
  it("sends a well-formed intent and applies the authoritative snapshot", async () => {
    const client = newClient();
    const roomCode = await client.createRoom();
    client.join(roomCode, "Alpha");
    const joined = await until(client, inSession);
    const start = joined.players[0]?.position.x ?? 0;

    expect(client.sendMoveIntent({ x: 1, y: 0 })).toBe(true);

    const view = await until(client, (v) => (v.players[0]?.position.x ?? 0) > start);
    expect(view.lastError).toBeNull();
  });

  it("refuses to send before a socket exists", () => {
    const client = newClient();
    expect(client.sendMoveIntent({ x: 1, y: 0 })).toBe(false);
    expect(client.setReady(true)).toBe(false);
  });
});

describe("reconnecting", () => {
  it("reclaims the same slot after the socket drops", async () => {
    const host = newClient();
    const roomCode = await host.createRoom();
    host.join(roomCode, "Alpha");
    await until(host, inSession);

    const guest = newClient();
    guest.join(roomCode, "Beta");
    await until(guest, inSession);
    await until(host, (v) => v.players.length === 2);

    guest.disconnect();
    const dropped = await until(host, (v) => v.players.some((p) => !p.connected));
    expect(dropped.players).toHaveLength(2);

    guest.join(roomCode, "Beta");
    const back = await until(host, (v) => v.players.every((p) => p.connected));
    expect(back.players).toHaveLength(2);
  });

  it("drops the player from the roster once the grace window closes", async () => {
    const host = newClient();
    const roomCode = await host.createRoom();
    host.join(roomCode, "Alpha");
    await until(host, inSession);

    const guest = newClient();
    guest.join(roomCode, "Beta");
    await until(guest, inSession);
    await until(host, (v) => v.players.length === 2);

    guest.disconnect();

    const view = await until(host, (v) => v.players.length === 1, 5000);
    expect(view.players[0]?.name).toBe("Alpha");
  });
});

describe("roguelite profiles", () => {
  const KEY = { id: "33333333-3333-4333-8333-333333333333", name: "Copper Key", kind: "key" as const };

  /**
   * Replaces the running server with a fresh one over the same profile storage, which is what a
   * restart looks like to a player: a new process, the same file on disk.
   */
  async function restartOver(storage: ProfileStorage): Promise<void> {
    await server.close();
    server = createGameServer({
      store: new SessionStore({ reconnectGraceMs: GRACE_MS, dungeon: { dungeonId: "ember-vault" } }),
      profiles: new ProfileStore({ storage }),
      tickIntervalMs: 20,
      sweepIntervalMs: 20,
      log: false,
    });
    const address = await server.listen(0, "127.0.0.1");
    httpUrl = `http://127.0.0.1:${address.port}`;
    wsUrl = `ws://127.0.0.1:${address.port}`;
  }

  it("issues a profile on a first join and stores its secret", async () => {
    const secrets = createMemoryProfileSecretStore();
    const client = newClient(undefined, secrets);
    const roomCode = await client.createRoom();

    client.join(roomCode, "Alpha");
    await until(client, inSession);

    const secret = secrets.read();
    expect(secret).toMatch(/^[0-9a-f]{32}$/);
    expect(server.profiles.find(secret)).not.toBeNull();
  });

  it("plays the same profile on a later join, without issuing a second one", async () => {
    const secrets = createMemoryProfileSecretStore();

    const first = newClient(undefined, secrets);
    const firstRoom = await first.createRoom();
    first.join(firstRoom, "Alpha");
    const joined = await until(first, inSession);
    const issued = secrets.read();

    // Leaving, not dropping: a held slot still owns the profile, which the next test is about.
    first.leave();
    await untilServer(() => server.store.findMember(joined.selfId!) === undefined);

    // A different room and a different socket, but the same device: one profile, not two.
    const second = newClient(undefined, secrets);
    const secondRoom = await second.createRoom();
    second.join(secondRoom, "Alpha");
    await until(second, inSession);

    expect(secrets.read()).toBe(issued);
    expect(server.profiles.size).toBe(1);
  });

  it("holds the profile for a dropped player until their slot is released", async () => {
    const secrets = createMemoryProfileSecretStore();

    const first = newClient(undefined, secrets);
    const roomCode = await first.createRoom();
    first.join(roomCode, "Alpha");
    await until(first, inSession);

    // A dropped socket is not a departure: the slot is theirs for the grace window, and so is the
    // profile. Letting a second party spend the same bank meanwhile is the thing being prevented.
    first.disconnect();

    const second = newClient(undefined, secrets);
    const otherRoom = await second.createRoom();
    second.join(otherRoom, "Alpha");
    const view = await until(second, (candidate) => candidate.lastError !== null);

    expect(view.lastError?.code).toBe("profileInUse");
  });

  it("gives two devices two profiles", async () => {
    const first = newClient();
    const second = newClient();
    const roomCode = await first.createRoom();

    first.join(roomCode, "Alpha");
    await until(first, inSession);
    second.join(roomCode, "Beta");
    await until(second, inSession);

    expect(server.profiles.size).toBe(2);
  });

  it("refuses a profile that is already playing, and says so", async () => {
    const secrets = createMemoryProfileSecretStore();

    const first = newClient(undefined, secrets);
    const roomCode = await first.createRoom();
    first.join(roomCode, "Alpha");
    await until(first, inSession);

    // The same device joining a second party while the first is still live.
    const second = newClient(undefined, secrets);
    const otherRoom = await second.createRoom();
    second.join(otherRoom, "Alpha");
    const view = await until(second, (candidate) => candidate.lastError !== null);

    expect(view.lastError?.code).toBe("profileInUse");
    // A join rejection, not a dead connection: the player can correct it and try again.
    expect(view.phase).toBe("connected");
  });

  it("returns a banked item to the same device after a server restart", async () => {
    const storage = createMemoryProfileStorage();
    await restartOver(storage);

    const secrets = createMemoryProfileSecretStore();
    const before = newClient(undefined, secrets);
    const firstRoom = await before.createRoom();
    before.join(firstRoom, "Alpha");
    const joined = await until(before, inSession);

    // What `returnToHub` does when a survivor walks out of the dungeon, applied directly: this test
    // is about the item outliving the process, and the run that earns it is covered elsewhere.
    const member = server.store.findMember(joined.selfId!);
    member!.player.profile.bankedItems.push({ ...KEY });
    markProfileChanged(member!.player.profile);
    before.disconnect();

    await restartOver(storage);

    const after = newClient(undefined, secrets);
    const secondRoom = await after.createRoom();
    after.join(secondRoom, "Alpha");
    const view = await until(after, inSession);

    // Read from the roster the client renders from, so this covers the whole path: file, profile,
    // player state, wire, and the view the HUD draws the bank out of.
    expect(view.players[0]?.bankedItems).toEqual([KEY]);
  });
});
