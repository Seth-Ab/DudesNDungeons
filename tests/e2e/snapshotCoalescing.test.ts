import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { PROTOCOL_VERSION } from "../../src/shared/constants/game.js";
import {
  createGameServer,
  type GameServer,
} from "../../src/server/gameServer.js";
import { SessionStore } from "../../src/server/sessions/sessionStore.js";
import type { ServerMessage } from "../../src/shared/protocol/index.js";

const frames = vi.hoisted(() => ({ calls: 0, rosters: 0 }));

vi.mock("../../src/server/game/visibility.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../src/server/game/visibility.js")
    >();
  return {
    ...actual,
    visibilityFrameForPlayer: (
      ...args: Parameters<typeof actual.visibilityFrameForPlayer>
    ) => {
      frames.calls += 1;
      return actual.visibilityFrameForPlayer(...args);
    },
  };
});

vi.mock("../../src/server/sessions/sessionStore.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../src/server/sessions/sessionStore.js")
    >();
  return {
    ...actual,
    rosterOf: (...args: Parameters<typeof actual.rosterOf>) => {
      frames.rosters += 1;
      return actual.rosterOf(...args);
    },
  };
});

/** Long enough that a burst of actions fits well inside one tick on any machine. */
const TICK_MS = 250;

let server: GameServer;
let wsUrl: string;
let baseUrl: string;
const sockets: WebSocket[] = [];

interface Client {
  inbox: ServerMessage[];
  ws: WebSocket;
  playerId: string;
}

async function join(roomCode: string, name: string): Promise<Client> {
  const ws = new WebSocket(wsUrl);
  sockets.push(ws);
  const inbox: ServerMessage[] = [];
  ws.on("message", (data) =>
    inbox.push(JSON.parse(data.toString()) as ServerMessage),
  );
  await new Promise<void>((resolve) => ws.once("open", () => resolve()));
  ws.send(
    JSON.stringify({
      type: "joinSession",
      protocolVersion: PROTOCOL_VERSION,
      roomCode,
      playerName: name,
    }),
  );
  await vi.waitFor(() =>
    expect(inbox.some((m) => m.type === "sessionJoined")).toBe(true),
  );
  const joined = inbox.find((m) => m.type === "sessionJoined");
  if (joined?.type !== "sessionJoined")
    throw new Error("expected sessionJoined");
  return { inbox, ws, playerId: joined.playerId };
}

const snapshotsOf = (client: Client) =>
  client.inbox.filter(
    (m): m is Extract<ServerMessage, { type: "stateSnapshot" }> =>
      m.type === "stateSnapshot",
  );

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(async () => {
  frames.calls = 0;
  frames.rosters = 0;
  server = createGameServer({
    store: new SessionStore({ dungeon: { dungeonId: "ember-vault" } }),
    tickIntervalMs: TICK_MS,
    log: false,
  });
  const address = await server.listen(0, "127.0.0.1");
  baseUrl = `http://127.0.0.1:${address.port}`;
  wsUrl = `ws://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  for (const ws of sockets.splice(0)) ws.close();
  await server.close();
});

async function createRoom(): Promise<string> {
  const response = await fetch(`${baseUrl}/sessions`, { method: "POST" });
  return ((await response.json()) as { roomCode: string }).roomCode;
}

describe("snapshot coalescing", () => {
  it("sends no snapshot for an accepted action, only on the tick", async () => {
    const alpha = await join(await createRoom(), "Alpha");
    await vi.waitFor(() =>
      expect(snapshotsOf(alpha).length).toBeGreaterThan(0),
    );
    // Align to just after a tick so the burst below cannot straddle one.
    const seen = snapshotsOf(alpha).length;
    await vi.waitFor(() => expect(snapshotsOf(alpha).length).toBe(seen + 1));
    await sleep(20);

    const before = snapshotsOf(alpha).length;
    const framesBefore = frames.calls;
    for (let sequence = 1; sequence <= 5; sequence += 1) {
      alpha.ws.send(
        JSON.stringify({
          type: "playerMoveIntent",
          sequence,
          direction: { x: 0, y: 1 },
        }),
      );
      await sleep(5);
    }
    await sleep(40);

    // Five intents (some accepted, the rest rate limited) and still not one extra snapshot.
    expect(snapshotsOf(alpha).length).toBe(before);
    expect(frames.calls).toBe(framesBefore);
  });

  it("builds the public roster once per tick, however many players are watching", async () => {
    const roomCode = await createRoom();
    const alpha = await join(roomCode, "Alpha");
    await join(roomCode, "Beta");
    await join(roomCode, "Gamma");

    const seen = snapshotsOf(alpha).length;
    const rostersBefore = frames.rosters;
    await vi.waitFor(() => expect(snapshotsOf(alpha).length).toBe(seen + 3));
    const ticks = snapshotsOf(alpha).length - seen;

    // One build per tick, plus at most one tick in flight; per-viewer builds would be three times that.
    expect(frames.rosters - rostersBefore).toBeLessThanOrEqual(ticks + 1);
  });

  it("emits at most one snapshot per tick and keeps ticks strictly increasing", async () => {
    const roomCode = await createRoom();
    const alpha = await join(roomCode, "Alpha");
    const beta = await join(roomCode, "Beta");

    const startedAt = Date.now();
    for (let sequence = 1; sequence <= 8; sequence += 1) {
      for (const client of [alpha, beta]) {
        client.ws.send(
          JSON.stringify({
            type: "playerMoveIntent",
            sequence,
            direction: { x: 0, y: 1 },
          }),
        );
      }
      await sleep(30);
    }
    await sleep(TICK_MS * 2);
    const elapsed = Date.now() - startedAt;

    for (const client of [alpha, beta]) {
      const ticks = snapshotsOf(client).map((s) => s.tick);
      for (let i = 1; i < ticks.length; i += 1)
        expect(ticks[i]).toBe(ticks[i - 1]! + 1);
      expect(ticks.length).toBeLessThanOrEqual(
        Math.ceil(elapsed / TICK_MS) + 2,
      );
    }
  });

  it("still applies every accepted action to the state the next snapshot carries", async () => {
    const alpha = await join(await createRoom(), "Alpha");
    const session = [...server.store.listSessions()][0]!;
    const start = session.players.get(alpha.playerId)!.position.y;

    alpha.ws.send(
      JSON.stringify({
        type: "playerMoveIntent",
        sequence: 1,
        direction: { x: 0, y: 1 },
      }),
    );

    await vi.waitFor(() =>
      expect(
        snapshotsOf(alpha).some(
          (s) => (s.players[0]?.position.y ?? start) > start,
        ),
      ).toBe(true),
    );
  });

  it("answers a rejected action immediately rather than on the next tick", async () => {
    const alpha = await join(await createRoom(), "Alpha");
    // Aligns to a tick boundary, so the rejection below has most of a tick to be late in.
    const seen = snapshotsOf(alpha).length;
    await vi.waitFor(() =>
      expect(snapshotsOf(alpha).length).toBeGreaterThan(seen),
    );

    const sentAt = Date.now();
    // A burst faster than the movement pacing allows, so most of it is refused on cooldown.
    for (let sequence = 1; sequence <= 10; sequence += 1) {
      alpha.ws.send(
        JSON.stringify({
          type: "playerMoveIntent",
          sequence,
          direction: { x: 0, y: 1 },
        }),
      );
    }
    await vi.waitFor(() =>
      expect(alpha.inbox.some((m) => m.type === "actionRejected")).toBe(true),
    );
    expect(Date.now() - sentAt).toBeLessThan(TICK_MS / 2);
  });
});
