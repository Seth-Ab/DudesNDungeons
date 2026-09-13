import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGameServer, type GameServer } from "../../src/server/gameServer.js";
import { SessionStore } from "../../src/server/sessions/sessionStore.js";
import { createMemoryTokenStore } from "../../src/client/network/endpoints.js";
import {
  createSessionClient,
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

function newClient(retryDelaysMs = [20, 40, 80]): SessionClient {
  const client = createSessionClient({
    httpUrl,
    wsUrl,
    tokenStore: createMemoryTokenStore(),
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

beforeEach(async () => {
  server = createGameServer({
    store: new SessionStore({ reconnectGraceMs: GRACE_MS }),
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
  it("sends a well-formed intent that the server accepts but has not implemented", async () => {
    const client = newClient();
    const roomCode = await client.createRoom();
    client.join(roomCode, "Alpha");
    await until(client, inSession);

    expect(client.sendMoveIntent({ x: 1, y: 0 })).toBe(true);

    // notImplemented proves the frame passed validation; invalidMessage would mean protocol drift.
    const view = await until(client, (v) => v.lastError !== null);
    expect(view.lastError?.code).toBe("notImplemented");
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
