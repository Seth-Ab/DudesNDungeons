import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createGameServer, type GameServer } from "../../src/server/gameServer.js";
import { SessionStore } from "../../src/server/sessions/sessionStore.js";
import { PROTOCOL_VERSION } from "../../src/shared/constants/game.js";
import type { ServerMessage } from "../../src/shared/protocol/index.js";
import { bowAims } from "../../src/client/state/bowIndicator.js";

/**
 * Two real sockets in one room: when one draws, the server's range reaches both, and each client's
 * indicator is built from it, so the drawer and the watching ally agree on the cue's length.
 */

let server: GameServer;
let store: SessionStore;
let wsUrl: string;
const sockets: WebSocket[] = [];

class Client {
  readonly inbox: ServerMessage[] = [];
  constructor(readonly ws: WebSocket) {
    ws.on("message", (data) => this.inbox.push(JSON.parse(data.toString()) as ServerMessage));
  }
  send(message: unknown): void {
    this.ws.send(JSON.stringify(message));
  }
  latestSnapshot() {
    return [...this.inbox].reverse().find((message) => message.type === "stateSnapshot");
  }
}

async function eventually<T>(read: () => T | undefined | null | false, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error("timed out waiting for the server");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function join(roomCode: string, playerName: string): Promise<{ client: Client; playerId: string }> {
  const ws = new WebSocket(wsUrl);
  sockets.push(ws);
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  const client = new Client(ws);
  client.send({ type: "joinSession", protocolVersion: PROTOCOL_VERSION, roomCode, playerName });
  const joined = await eventually(() => client.inbox.find((message) => message.type === "sessionJoined"));
  if (joined.type !== "sessionJoined") throw new Error("join failed");
  return { client, playerId: joined.playerId };
}

beforeEach(async () => {
  store = new SessionStore();
  server = createGameServer({ store, tickIntervalMs: 20, sweepIntervalMs: 10_000, autosaveIntervalMs: 60_000, log: false });
  const address = await server.listen(0, "127.0.0.1");
  wsUrl = `ws://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.close();
  await server.close();
});

describe("bow indicator range over the wire", () => {
  it("shows the drawing player and a watching ally the same server range", async () => {
    const roomCode = store.createSession().roomCode;
    const archer = await join(roomCode, "Archer");
    const watcher = await join(roomCode, "Watcher");

    archer.client.send({ type: "setAppearance", appearance: { body: "girl", skinTone: "tan", hairStyle: "bun", hairColor: "silver" } });
    await eventually(() => store.getSession(roomCode)!.players.get(archer.playerId)!.appearance);

    const player = store.getSession(roomCode)!.players.get(archer.playerId)!;
    player.held = { id: "a0000000-0000-4000-8000-0000000000b1", name: "Hunting Bow", kind: "weapon", itemId: "hunting-bow", weaponKind: "ranged" };
    player.inventory = [{ id: "a0000000-0000-4000-8000-0000000000b3", name: "Arrows", kind: "ammo", itemId: "arrow", count: 3 }];

    archer.client.send({ type: "beginDraw", sequence: 1, direction: { x: 1, y: 0 } });

    const drawerView = (client: Client) => {
      const snapshot = client.latestSnapshot();
      if (snapshot?.type !== "stateSnapshot") return null;
      const me = snapshot.players.find((candidate) => candidate.id === archer.playerId);
      return me && me.drawFraction !== null && me.drawRange ? me : null;
    };
    const seenByArcher = await eventually(() => drawerView(archer.client));
    const seenByWatcher = await eventually(() => drawerView(watcher.client));

    expect(seenByWatcher.drawRange).toEqual(seenByArcher.drawRange);
    expect(seenByArcher.drawRange).toEqual({ minRange: 4, maxRange: 14 });

    // Each client's cue length follows from the range it was sent.
    const ownCue = bowAims({ ...seenByArcher, drawFraction: 1 }, { x: 0, y: 0 }, null, [])[0];
    const allyCue = bowAims(null, { x: 0, y: 0 }, null, [{ ...seenByWatcher, drawFraction: 1 }])[0];
    expect(ownCue?.fullLength).toBe(14);
    expect(allyCue?.fullLength).toBe(14 * 0.5);
  });
});
