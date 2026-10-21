import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import {
  ATTACK_STAMINA_COST,
  LIFT_STAMINA_COST,
  MAX_CLIENT_MESSAGE_BYTES,
  MAX_CLIENT_MESSAGE_CHARS,
  MAX_VOICE_SIGNAL_LENGTH,
  PLAYER_BASE_RESISTANCE,
  PLAYER_MAX_STAMINA,
  PROTOCOL_VERSION,
  RESISTANCE_DECAY_GRACE_MS,
  VOICE_SIGNAL_BURST,
} from "../../src/shared/constants/game.js";
import { PLAYER_STEP_DISTANCE } from "../../src/shared/game/movement.js";
import { createGameServer, type GameServer } from "../../src/server/gameServer.js";
import { learnSkill } from "../../src/server/game/progression.js";
import { returnToHub } from "../../src/server/game/runLifecycle.js";
import { SessionStore } from "../../src/server/sessions/sessionStore.js";
import type { ServerMessage } from "../../src/shared/protocol/index.js";
import { at } from "../server/fixtures.js";

/** Short enough that the reconnect timeout is testable in real time. */
const GRACE_MS = 150;
const TICK_MS = 20;
const SWEEP_MS = 20;

let server: GameServer;
let baseUrl: string;
let wsUrl: string;
const openClients: TestClient[] = [];

/**
 * A party member over a real socket. Buffers everything the server sends so a test can assert on
 * what arrived rather than on when it arrived.
 */
class TestClient {
  readonly inbox: ServerMessage[] = [];
  readonly #ws: WebSocket;

  private constructor(ws: WebSocket) {
    this.#ws = ws;
    ws.on("message", (data) => this.inbox.push(JSON.parse(data.toString()) as ServerMessage));
  }

  static async connect(): Promise<TestClient> {
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    const client = new TestClient(ws);
    openClients.push(client);
    return client;
  }

  send(message: unknown): void {
    this.#ws.send(JSON.stringify(message));
  }

  /** Sends exactly these bytes: a text frame for a string, a binary frame for a Buffer. */
  sendRaw(data: string | Buffer): void {
    this.#ws.send(data);
  }

  /** Resolves with the close code once the server has dropped the connection. */
  closed(timeoutMs = 2000): Promise<number> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out waiting for close")), timeoutMs);
      this.#ws.once("close", (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
  }

  join(roomCode: string, playerName: string, resumeToken?: string): void {
    this.send({
      type: "joinSession",
      protocolVersion: PROTOCOL_VERSION,
      roomCode,
      playerName,
      ...(resumeToken === undefined ? {} : { resumeToken }),
    });
  }

  /** Resolves with the next message of `type` to arrive after this call. */
  next<T extends ServerMessage["type"]>(
    type: T,
    timeoutMs = 2000,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    return this.nextWhere(type, () => true, timeoutMs);
  }

  /**
   * Resolves with the next message of `type` that satisfies `matches`.
   *
   * The server broadcasts a snapshot every tick as well as after an action, so "the next snapshot"
   * after sending an intent is not necessarily the snapshot that carries its result. Waiting on the
   * content rather than on the arrival is what makes an assertion about an action deterministic.
   */
  nextWhere<T extends ServerMessage["type"]>(
    type: T,
    matches: (message: Extract<ServerMessage, { type: T }>) => boolean,
    timeoutMs = 2000,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    const from = this.inbox.length;
    const deadline = Date.now() + timeoutMs;

    return new Promise((resolve, reject) => {
      const poll = (): void => {
        const found = this.inbox
          .slice(from)
          .find(
            (message) =>
              message.type === type && matches(message as Extract<ServerMessage, { type: T }>),
          );
        if (found) {
          resolve(found as Extract<ServerMessage, { type: T }>);
          return;
        }
        if (Date.now() > deadline) {
          reject(new Error(`timed out waiting for ${type}`));
          return;
        }
        setTimeout(poll, 5);
      };
      poll();
    });
  }

  /**
   * Resolves with the first message of `type` to arrive after `after`, which must be in the inbox.
   * For a message the server sends unprompted right behind another, such as the first snapshot
   * after `sessionJoined`: it can land before a `next` call made afterwards starts watching.
   */
  firstAfter<T extends ServerMessage["type"]>(
    after: ServerMessage,
    type: T,
    timeoutMs = 2000,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    const from = this.inbox.indexOf(after) + 1;
    if (from === 0) throw new Error(`${after.type} is not in the inbox`);
    const deadline = Date.now() + timeoutMs;

    return new Promise((resolve, reject) => {
      const poll = (): void => {
        const found = this.inbox.slice(from).find((message) => message.type === type);
        if (found) {
          resolve(found as Extract<ServerMessage, { type: T }>);
          return;
        }
        if (Date.now() > deadline) {
          reject(new Error(`timed out waiting for ${type}`));
          return;
        }
        setTimeout(poll, 5);
      };
      poll();
    });
  }

  received<T extends ServerMessage["type"]>(type: T): Extract<ServerMessage, { type: T }>[] {
    return this.inbox.filter((message) => message.type === type) as Extract<
      ServerMessage,
      { type: T }
    >[];
  }

  close(): void {
    this.#ws.close();
  }
}

async function createRoom(): Promise<string> {
  const response = await fetch(`${baseUrl}/sessions`, { method: "POST" });
  expect(response.status).toBe(201);
  const body = (await response.json()) as { roomCode: string };
  return body.roomCode;
}

/** The look `joinRoom` designs, so the joined player is in the world and can act. */
const LOOK = { body: "girl", skinTone: "tan", hairStyle: "bun", hairColor: "silver" } as const;

/**
 * Joins and returns the private `sessionJoined`, which is where the resume token lives. A slot that
 * needs a look gets `LOOK` unless `designed` is false, and this waits until a snapshot shows it: the
 * server spawns the player then, and a test that moves them on the server must not race the spawn.
 */
async function joinRoom(roomCode: string, name: string, resumeToken?: string, designed = true) {
  const client = await TestClient.connect();
  client.join(roomCode, name, resumeToken);
  const joined = await client.next("sessionJoined");
  if (designed && joined.needsAppearance) {
    client.send({ type: "setAppearance", appearance: LOOK });
    await client.nextWhere("stateSnapshot", (snapshot) =>
      snapshot.players.some((player) => player.id === joined.playerId && player.appearance !== null),
    );
  }
  return { client, joined };
}

/** Ready one-player tests and use the authored hub entrance through the real socket contract. */
async function enterDungeon(roomCode: string, client: TestClient) {
  client.send({ type: "setReady", ready: true });
  await client.next("playerReadyChanged");

  const session = server.store.getSession(roomCode);
  if (!session) throw new Error("expected session");
  const entrance = session.dungeon.exits[0];
  const player = [...session.players.values()][0];
  if (!entrance || !player) throw new Error("expected hub entrance and player");

  player.position = { ...entrance.position };
  client.send({ type: "playerInteract", targetId: entrance.id });
  return client.nextWhere("stateSnapshot", (snapshot) => snapshot.location === "dungeon");
}

beforeEach(async () => {
  server = createGameServer({
    // The authored dungeon, so the assertions below can name a map and known entity positions.
    store: new SessionStore({ reconnectGraceMs: GRACE_MS, dungeon: { dungeonId: "ember-vault" } }),
    tickIntervalMs: TICK_MS,
    sweepIntervalMs: SWEEP_MS,
    log: false,
  });
  const address = await server.listen(0, "127.0.0.1");
  baseUrl = `http://127.0.0.1:${address.port}`;
  wsUrl = `ws://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  for (const client of openClients.splice(0)) client.close();
  await server.close();
});

describe("http surface", () => {
  it("reports health and the live session count", async () => {
    const before = (await (await fetch(`${baseUrl}/health`)).json()) as { sessions: number };
    expect(before.sessions).toBe(0);

    await createRoom();

    const after = (await (await fetch(`${baseUrl}/health`)).json()) as {
      status: string;
      protocolVersion: number;
      sessions: number;
    };
    expect(after.status).toBe("ok");
    expect(after.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(after.sessions).toBe(1);
  });

  it("404s an unknown route", async () => {
    expect((await fetch(`${baseUrl}/nope`)).status).toBe(404);
  });

  // The client is served from a different origin in development, so without this header the
  // browser blocks room creation even though the request itself succeeds.
  it("allows cross-origin room creation", async () => {
    const response = await fetch(`${baseUrl}/sessions`, {
      method: "POST",
      headers: { origin: "http://localhost:5173" },
    });

    expect(response.status).toBe(201);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
  });
});

describe("joining a dungeon", () => {
  it("admits a player and reports the roster", async () => {
    const roomCode = await createRoom();
    const { joined } = await joinRoom(roomCode, "Alpha");

    expect(joined.resumed).toBe(false);
    expect(joined.roomCode).toBe(roomCode);
    expect(joined.resumeToken).toMatch(/^[0-9a-f]{32}$/);
    expect(joined.players).toHaveLength(1);
    expect(joined.players[0]?.health).toBe(100);
    expect(joined.players[0]?.ready).toBe(false);
  });

  it("tells the party about a new arrival", async () => {
    const roomCode = await createRoom();
    const alpha = await joinRoom(roomCode, "Alpha");

    const arrival = alpha.client.next("playerJoined");
    const beta = await joinRoom(roomCode, "Beta");

    const { player } = await arrival;
    expect(player.name).toBe("Beta");
    expect(player).not.toHaveProperty("bankedItems");
    expect(beta.joined.players).toHaveLength(2);
  });

  it("refuses an unknown room code", async () => {
    const client = await TestClient.connect();
    client.join("ZZZZZZ", "Alpha");

    expect((await client.next("sessionError")).code).toBe("sessionNotFound");
  });

  it("refuses a client speaking a different protocol version", async () => {
    const roomCode = await createRoom();
    const client = await TestClient.connect();
    client.send({
      type: "joinSession",
      protocolVersion: PROTOCOL_VERSION + 1,
      roomCode,
      playerName: "Alpha",
    });

    expect((await client.next("sessionError")).code).toBe("protocolVersionMismatch");
  });

  it("refuses a second join on the same connection", async () => {
    const roomCode = await createRoom();
    const { client } = await joinRoom(roomCode, "Alpha");

    client.join(roomCode, "Alpha Again");

    expect((await client.next("sessionError")).code).toBe("alreadyInSession");
  });

  it("refuses gameplay messages before joining", async () => {
    const client = await TestClient.connect();
    client.send({ type: "setReady", ready: true });

    expect((await client.next("sessionError")).code).toBe("notInSession");
  });

  it("rejects a malformed frame without dropping the connection", async () => {
    const roomCode = await createRoom();
    const { client } = await joinRoom(roomCode, "Alpha");

    client.send("not-a-message");
    expect((await client.next("sessionError")).code).toBe("invalidMessage");

    client.send({ type: "setReady", ready: true });
    await expect(client.next("playerReadyChanged")).resolves.toBeDefined();
  });

  it("rejects a frame that is not JSON without dropping the connection", async () => {
    const roomCode = await createRoom();
    const { client } = await joinRoom(roomCode, "Alpha");

    client.sendRaw("{not json");
    const error = await client.next("sessionError");
    expect(error.code).toBe("invalidMessage");
    expect(error.message).toMatch(/not valid JSON/);

    client.send({ type: "setReady", ready: true });
    await expect(client.next("playerReadyChanged")).resolves.toBeDefined();
  });

  it("rejects a binary frame without decoding it, keeping the connection", async () => {
    const roomCode = await createRoom();
    const { client } = await joinRoom(roomCode, "Alpha");

    // A well-formed message, so only the frame type can be the reason it is refused.
    client.sendRaw(Buffer.from(JSON.stringify({ type: "setReady", ready: true })));
    const error = await client.next("sessionError");
    expect(error.code).toBe("invalidMessage");
    expect(error.message).toMatch(/Binary frames/);
    expect(client.received("playerReadyChanged")).toHaveLength(0);

    client.send({ type: "setReady", ready: true });
    await expect(client.next("playerReadyChanged")).resolves.toBeDefined();
  });

  it("carries the largest valid voice signal through the transport limit", async () => {
    const roomCode = await createRoom();
    const { client } = await joinRoom(roomCode, "Alpha");
    const beta = await joinRoom(roomCode, "Beta");

    // Three UTF-8 bytes per character: the most bytes a schema-valid signal can occupy, and more
    // than a limit counted in characters would allow.
    const frame = JSON.stringify({
      type: "voiceSignal",
      targetPlayerId: beta.joined.playerId,
      signal: { kind: "offer", sdp: "€".repeat(MAX_VOICE_SIGNAL_LENGTH) },
    });
    expect(Buffer.byteLength(frame)).toBeGreaterThan(MAX_CLIENT_MESSAGE_CHARS);
    expect(Buffer.byteLength(frame)).toBeLessThanOrEqual(MAX_CLIENT_MESSAGE_BYTES);

    const relayed = beta.client.next("voiceSignalRelay");
    client.sendRaw(frame);

    const relay = await relayed;
    expect(relay.signal.kind === "offer" && relay.signal.sdp.length).toBe(MAX_VOICE_SIGNAL_LENGTH);
  });

  it("parses a frame of exactly the byte limit instead of dropping the connection", async () => {
    const roomCode = await createRoom();
    const { client } = await joinRoom(roomCode, "Alpha");

    client.sendRaw("x".repeat(MAX_CLIENT_MESSAGE_BYTES));
    const error = await client.next("sessionError");
    expect(error.code).toBe("invalidMessage");
    expect(error.message).toMatch(/maximum allowed size/);

    client.send({ type: "setReady", ready: true });
    await expect(client.next("playerReadyChanged")).resolves.toBeDefined();
  });

  it("closes the connection on an oversized frame without parsing it", async () => {
    const roomCode = await createRoom();
    const { client } = await joinRoom(roomCode, "Alpha");
    const closed = client.closed();

    client.sendRaw("x".repeat(MAX_CLIENT_MESSAGE_BYTES + 1));

    // 1009 is "message too big"; the transport refuses it before the protocol layer sees it.
    expect(await closed).toBe(1009);
    expect(client.received("sessionError")).toHaveLength(0);
  });

  it("accepts movement intent and broadcasts the authoritative position", async () => {
    const roomCode = await createRoom();
    const { client, joined } = await joinRoom(roomCode, "Alpha");
    const start = joined.players[0]?.position.x ?? 0;

    client.send({ type: "playerMoveIntent", sequence: 1, direction: { x: 1, y: 0 } });

    // The snapshot carrying the move, not merely the next tick's, which may still show the old spot.
    const snapshot = await client.nextWhere(
      "stateSnapshot",
      (message) => (message.players[0]?.position.x ?? start) > start,
    );
    expect(snapshot.players[0]?.position.x).toBeGreaterThan(start);
    expect(snapshot.location).toBe("hub");
    expect(snapshot.dungeon.map.id).toBe("hub");
  });

  it("caps movement speed no matter how fast intents arrive", async () => {
    const roomCode = await createRoom();
    const { client, joined } = await joinRoom(roomCode, "Alpha");
    const start = joined.players[0]?.position.y ?? 0;

    const burst = 10;
    for (let sequence = 1; sequence <= burst; sequence += 1) {
      client.send({ type: "playerMoveIntent", sequence, direction: { x: 0, y: 1 } });
    }

    await client.next("actionRejected");
    // A couple of ticks later, every intent in the burst has been answered.
    await client.next("stateSnapshot");
    await client.next("stateSnapshot");

    const rejected = client
      .received("actionRejected")
      .filter((message) => message.reason === "onCooldown").length;
    const latest = client.received("stateSnapshot").at(-1);

    expect(rejected).toBeGreaterThan(0);
    expect(latest?.players[0]?.position.y).toBeCloseTo(
      start + (burst - rejected) * PLAYER_STEP_DISTANCE,
    );
  });

  it("resolves a swing at nothing and refuses loot out of reach", async () => {
    const roomCode = await createRoom();
    const { client } = await joinRoom(roomCode, "Alpha");
    await enterDungeon(roomCode, client);

    client.send({ type: "playerAttack", sequence: 1, direction: { x: 1, y: 0 }, targetId: null });
    const swing = await client.next("attackResolved");
    expect(swing.targetId).toBeNull();

    const copperKeyId = "33333333-3333-4333-8333-333333333333";
    client.send({ type: "pickupItem", itemId: copperKeyId });
    expect((await client.next("actionRejected")).reason).toBe("outOfRange");

    const snapshot = await client.next("stateSnapshot");
    expect(snapshot.players[0]?.inventory).toEqual([]);
    expect(snapshot.location).toBe("dungeon");
  });

  it("sends vitals and the run clock to a real client", async () => {
    const roomCode = await createRoom();
    const { client, joined } = await joinRoom(roomCode, "Alpha");

    expect(joined.players[0]).toMatchObject({
      resistance: PLAYER_BASE_RESISTANCE,
      stamina: PLAYER_MAX_STAMINA,
    });

    await enterDungeon(roomCode, client);

    client.send({ type: "playerAttack", sequence: 1, direction: { x: 1, y: 0 }, targetId: null });
    await client.next("attackResolved");

    const snapshot = await client.next("stateSnapshot");
    expect(snapshot.players[0]?.stamina).toBeLessThanOrEqual(
      PLAYER_MAX_STAMINA - ATTACK_STAMINA_COST + 1,
    );
    expect(snapshot.run.decaying).toBe(false);
    expect(snapshot.run.decayStartsInMs).toBeGreaterThan(RESISTANCE_DECAY_GRACE_MS - 5_000);
  });
});

describe("character appearance", () => {
  const DESIGNED = { body: "guy", skinTone: "deep", hairStyle: "crop", hairColor: "azure" } as const;
  const ANY_ID = "a1111111-1111-4111-8111-111111111111";

  it("asks a fresh join for a look, then carries it to every party member", async () => {
    const roomCode = await createRoom();
    const alpha = await joinRoom(roomCode, "Alpha", undefined, false);
    const beta = await joinRoom(roomCode, "Beta");

    expect(alpha.joined.needsAppearance).toBe(true);
    expect(alpha.joined.players.find((p) => p.id === alpha.joined.playerId)).toMatchObject({
      appearance: null,
      partyColor: "ember",
    });
    expect(beta.joined.needsAppearance).toBe(true);
    expect(beta.joined.players.find((p) => p.id === beta.joined.playerId)?.partyColor).toBe("moss");

    alpha.client.send({ type: "setAppearance", appearance: DESIGNED });

    for (const viewer of [alpha.client, beta.client]) {
      const snapshot = await viewer.nextWhere("stateSnapshot", (message) =>
        message.players.some((p) => p.id === alpha.joined.playerId && p.appearance !== null),
      );
      expect(snapshot.players.find((p) => p.id === alpha.joined.playerId)?.appearance).toEqual(
        DESIGNED,
      );
    }
    expect(alpha.client.received("sessionError")).toEqual([]);
  });

  it("refuses an unknown id in each field, a missing field, and an extra one", async () => {
    const roomCode = await createRoom();
    const { client, joined } = await joinRoom(roomCode, "Alpha", undefined, false);
    const { hairColor: _dropped, ...missing } = DESIGNED;

    for (const appearance of [
      { ...DESIGNED, body: "ogre" },
      { ...DESIGNED, skinTone: "green" },
      { ...DESIGNED, hairStyle: "mohawk" },
      { ...DESIGNED, hairColor: "chartreuse" },
      missing,
      { ...DESIGNED, hat: "crown" },
    ]) {
      client.send({ type: "setAppearance", appearance });
      expect((await client.next("sessionError")).code, JSON.stringify(appearance)).toBe(
        "invalidAppearance",
      );
    }

    expect(server.store.findMember(joined.playerId)?.player.appearance).toBeNull();
  });

  it("locks the look after the first one", async () => {
    const roomCode = await createRoom();
    const { client, joined } = await joinRoom(roomCode, "Alpha", undefined, false);

    client.send({ type: "setAppearance", appearance: DESIGNED });
    client.send({ type: "setAppearance", appearance: { ...DESIGNED, hairColor: "black" } });

    expect((await client.next("sessionError")).code).toBe("appearanceLocked");
    expect(server.store.findMember(joined.playerId)?.player.appearance).toEqual(DESIGNED);
  });

  it("refuses a look before sessionJoined", async () => {
    const client = await TestClient.connect();
    client.send({ type: "setAppearance", appearance: DESIGNED });

    expect((await client.next("sessionError")).code).toBe("notInSession");
  });

  it("refuses movement, interaction, attacks, items, and ready while designing", async () => {
    const roomCode = await createRoom();
    const alpha = await joinRoom(roomCode, "Alpha", undefined, false);
    const session = server.store.getSession(roomCode)!;
    const player = session.players.get(alpha.joined.playerId)!;
    const torch = session.dungeon.loot.find((loot) => loot.kind === "torch")!;
    const entrance = session.dungeon.exits[0]!;
    player.position = { ...torch.position };
    player.inventory = [{ id: ANY_ID, name: "Copper Key", kind: "key" }];
    const before = { ...player.position };

    alpha.client.send({ type: "playerMoveIntent", sequence: 7, direction: { x: 1, y: 0 } });
    expect(await alpha.client.next("actionRejected")).toMatchObject({ sequence: 7, reason: "notPermitted" });
    alpha.client.send({ type: "playerAttack", sequence: 8, direction: { x: 1, y: 0 }, targetId: null });
    expect(await alpha.client.next("actionRejected")).toMatchObject({ sequence: 8, reason: "notPermitted" });

    for (const message of [
      { type: "pickupItem", itemId: torch.id },
      { type: "playerInteract", targetId: entrance.id },
      { type: "useItem", itemId: ANY_ID },
      { type: "dropItem", itemId: ANY_ID },
      { type: "swapHeld", itemId: ANY_ID },
      { type: "giveItem", itemId: ANY_ID, targetPlayerId: alpha.joined.playerId },
      { type: "liftPlayer", targetPlayerId: alpha.joined.playerId },
      { type: "dropCarry" },
      { type: "setReady", ready: true },
    ]) {
      alpha.client.send(message);
      expect(await alpha.client.next("actionRejected"), message.type).toMatchObject({
        sequence: null,
        reason: "notPermitted",
      });
    }

    expect(player.position).toEqual(before);
    expect(player.carryingTorch).toBe(false);
    expect(player.inventory).toHaveLength(1);
    expect(player.ready).toBe(false);
    expect(alpha.client.received("playerReadyChanged")).toEqual([]);
    expect(alpha.client.received("attackResolved")).toEqual([]);
  });

  it("keeps the party out of a run while anyone is still designing", async () => {
    const roomCode = await createRoom();
    const designing = await joinRoom(roomCode, "Designing", undefined, false);
    const ready = await joinRoom(roomCode, "Ready");
    const session = server.store.getSession(roomCode)!;
    const entrance = session.dungeon.exits[0]!;
    session.players.get(ready.joined.playerId)!.position = { ...entrance.position };
    // Forced, because the server refuses the designer's own ready: what is under test is that a
    // missing look keeps the door shut by itself.
    session.players.get(designing.joined.playerId)!.ready = true;

    ready.client.send({ type: "setReady", ready: true });
    await ready.client.next("playerReadyChanged");
    ready.client.send({ type: "playerInteract", targetId: entrance.id });

    expect((await ready.client.next("actionRejected")).reason).toBe("notPermitted");
    expect(session.location).toBe("hub");
  });

  it("holds a designing slot through the grace window, still asking for a look, then releases it", async () => {
    const roomCode = await createRoom();
    const alpha = await joinRoom(roomCode, "Alpha", undefined, false);
    const beta = await joinRoom(roomCode, "Beta");

    const dropped = beta.client.next("playerConnectionChanged");
    alpha.client.close();
    await dropped;

    const resumed = await joinRoom(roomCode, "Alpha", alpha.joined.resumeToken, false);
    expect(resumed.joined.resumed).toBe(true);
    expect(resumed.joined.needsAppearance).toBe(true);
    expect(resumed.joined.players.find((p) => p.id === alpha.joined.playerId)).toMatchObject({
      appearance: null,
      partyColor: "ember",
    });

    resumed.client.close();
    const left = await beta.client.next("playerLeft", 3000);
    expect(left).toMatchObject({ playerId: alpha.joined.playerId, reason: "timedOut" });
  });

  it("resumes a designed slot without asking again, keeping its look and colour", async () => {
    const roomCode = await createRoom();
    const alpha = await joinRoom(roomCode, "Alpha");
    const beta = await joinRoom(roomCode, "Beta");

    const dropped = alpha.client.next("playerConnectionChanged");
    beta.client.close();
    await dropped;

    const resumed = await joinRoom(roomCode, "Beta", beta.joined.resumeToken);
    expect(resumed.joined.needsAppearance).toBe(false);
    expect(resumed.joined.players.find((p) => p.id === beta.joined.playerId)).toMatchObject({
      appearance: LOOK,
      partyColor: "moss",
    });
  });
});

describe("party roster", () => {
  const rosterOf = (client: TestClient) => client.received("partyRoster");

  /**
   * The first roster in the client's whole inbox that satisfies `matches`. Not `nextWhere`, which
   * only watches what arrives after the call: the roster rides the first tick, which can land
   * before the test starts waiting.
   */
  async function rosterWhere(
    client: TestClient,
    matches: (message: ServerMessage & { type: "partyRoster" }) => boolean,
    timeoutMs = 2000,
    after?: ServerMessage,
  ) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const all = rosterOf(client);
      const found = all.slice(after ? all.indexOf(after as (typeof all)[number]) + 1 : 0).find(matches);
      if (found) return found;
      if (Date.now() > deadline) throw new Error("timed out waiting for a matching partyRoster");
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }

  it("lists exactly identity, colour and connection, and nothing about the body", async () => {
    const roomCode = await createRoom();
    const alpha = await joinRoom(roomCode, "Alpha");
    const beta = await joinRoom(roomCode, "Beta");

    // Make the roster's subject as revealing as possible: hurt, downed-adjacent, far away, worn down.
    const session = server.store.getSession(roomCode);
    const betaPlayer = session?.players.get(beta.joined.playerId);
    if (!betaPlayer) throw new Error("expected beta");
    betaPlayer.health = 0;
    betaPlayer.resistance = 3;
    betaPlayer.position = { x: 123.5, y: 456.5 };

    const roster = await rosterWhere(alpha.client, (message) => message.members.length === 2);

    expect(roster.members.map((member) => Object.keys(member).sort())).toEqual([
      ["connected", "name", "partyColor", "playerId"],
      ["connected", "name", "partyColor", "playerId"],
    ]);
    expect(roster.members).toEqual([
      { playerId: alpha.joined.playerId, name: "Alpha", partyColor: "ember", connected: true },
      { playerId: beta.joined.playerId, name: "Beta", partyColor: "moss", connected: true },
    ]);

    // Nothing the roster carries, on any message of that type, mentions the body.
    for (const message of [...rosterOf(alpha.client), ...rosterOf(beta.client)]) {
      const text = JSON.stringify(message);
      for (const leak of ["position", "health", "resistance", "123.5", "456.5", "downed", "stamina"]) {
        expect(text, leak).not.toContain(leak);
      }
    }
  });

  it("leaves out a member who is still designing, then lists them once they have a look", async () => {
    const roomCode = await createRoom();
    const alpha = await joinRoom(roomCode, "Alpha");
    const beta = await joinRoom(roomCode, "Beta", undefined, false);

    await alpha.client.nextWhere("stateSnapshot", () => true);
    expect(rosterOf(alpha.client).at(-1)?.members.map((member) => member.name)).toEqual(["Alpha"]);

    beta.client.send({ type: "setAppearance", appearance: LOOK });
    const grown = await rosterWhere(alpha.client, (message) => message.members.length === 2);
    expect(grown.members.map((member) => member.name)).toEqual(["Alpha", "Beta"]);
  });

  it("follows a drop, a reconnect and a timeout, and resends in full to a new socket", async () => {
    const roomCode = await createRoom();
    const alpha = await joinRoom(roomCode, "Alpha");
    const beta = await joinRoom(roomCode, "Beta");

    beta.client.close();
    const dropped = await rosterWhere(
      alpha.client,
      (message) => message.members.find((member) => member.name === "Beta")?.connected === false,
    );
    expect(dropped.members).toHaveLength(2);

    const resumed = await joinRoom(roomCode, "Beta", beta.joined.resumeToken);
    expect(resumed.joined.resumed).toBe(true);
    const full = await rosterWhere(resumed.client, () => true);
    expect(full.members.map((member) => member.connected)).toEqual([true, true]);
    await rosterWhere(
      alpha.client,
      (message) => message.members.every((member) => member.connected),
      2000,
      dropped,
    );

    resumed.client.close();
    const timedOut = await rosterWhere(alpha.client, (message) => message.members.length === 1, 3000);
    expect(timedOut.members.map((member) => member.name)).toEqual(["Alpha"]);
  });

  it("drops a member who leaves", async () => {
    const roomCode = await createRoom();
    const alpha = await joinRoom(roomCode, "Alpha");
    const beta = await joinRoom(roomCode, "Beta");
    await rosterWhere(alpha.client, (message) => message.members.length === 2);

    beta.client.send({ type: "leaveSession" });
    const shrunk = await rosterWhere(alpha.client, (message) => message.members.length === 1);
    expect(shrunk.members[0]?.name).toBe("Alpha");
  });
});

describe("resume tokens stay private", () => {
  it("never sends a player's token to anyone else", async () => {
    const roomCode = await createRoom();
    const alpha = await joinRoom(roomCode, "Alpha");
    const beta = await joinRoom(roomCode, "Beta");

    await alpha.client.next("stateSnapshot");

    expect(JSON.stringify(alpha.client.inbox)).not.toContain(beta.joined.resumeToken);
    expect(JSON.stringify(beta.client.inbox)).not.toContain(alpha.joined.resumeToken);
  });

  it("keeps tokens out of snapshots", async () => {
    const roomCode = await createRoom();
    const alpha = await joinRoom(roomCode, "Alpha");

    const snapshot = await alpha.client.next("stateSnapshot");

    expect(JSON.stringify(snapshot)).not.toContain(alpha.joined.resumeToken);
    expect(snapshot.players[0]).not.toHaveProperty("resumeToken");
    expect(snapshot.location).toBe("hub");
    expect(snapshot.dungeon.map.id).toBe("hub");
    expect(snapshot.dungeon.loot.map((loot) => loot.name)).toContain("Traveler's Torch");
  });
});

describe("ready state", () => {
  it("broadcasts a ready change to the party", async () => {
    const roomCode = await createRoom();
    const alpha = await joinRoom(roomCode, "Alpha");
    const beta = await joinRoom(roomCode, "Beta");

    const seen = beta.client.next("playerReadyChanged");
    alpha.client.send({ type: "setReady", ready: true });

    const event = await seen;
    expect(event.playerId).toBe(alpha.joined.playerId);
    expect(event.ready).toBe(true);
  });
});

describe("hub and run lifecycle", () => {
  it("starts only when the whole connected party is ready", async () => {
    const roomCode = await createRoom();
    const alpha = await joinRoom(roomCode, "Alpha");
    const beta = await joinRoom(roomCode, "Beta");
    const session = server.store.getSession(roomCode);
    if (!session) throw new Error("expected session");
    const entrance = session.dungeon.exits[0]!;
    session.players.get(alpha.joined.playerId)!.position = { ...entrance.position };

    alpha.client.send({ type: "setReady", ready: true });
    await alpha.client.next("playerReadyChanged");
    alpha.client.send({ type: "playerInteract", targetId: entrance.id });
    expect((await alpha.client.next("actionRejected")).reason).toBe("notPermitted");

    beta.client.send({ type: "setReady", ready: true });
    await alpha.client.next("playerReadyChanged");
    alpha.client.send({ type: "playerInteract", targetId: entrance.id });

    const snapshot = await alpha.client.nextWhere(
      "stateSnapshot",
      (message) => message.location === "dungeon",
    );
    expect(snapshot.dungeon.map.id).toBe("ember-vault");
    expect(snapshot.players.every((player) => !player.ready)).toBe(true);
  });

  it("equips a deliberately picked-up hub torch without spending an inventory slot", async () => {
    const roomCode = await createRoom();
    const alpha = await joinRoom(roomCode, "Alpha");
    const session = server.store.getSession(roomCode);
    if (!session) throw new Error("expected session");
    const player = session.players.get(alpha.joined.playerId)!;
    const torch = session.dungeon.loot.find((loot) => loot.kind === "torch")!;
    player.position = { ...torch.position };

    alpha.client.send({ type: "pickupItem", itemId: torch.id });
    const equipped = await alpha.client.nextWhere(
      "stateSnapshot",
      (message) => message.players[0]?.carryingTorch === true,
    );

    expect(equipped.players[0]?.inventory).toEqual([]);
    expect(equipped.players[0]?.carryingTorch).toBe(true);
  });

  it("refuses a fresh join during a run while leaving reconnect available", async () => {
    const roomCode = await createRoom();
    const alpha = await joinRoom(roomCode, "Alpha");
    await enterDungeon(roomCode, alpha.client);

    const late = await TestClient.connect();
    late.join(roomCode, "Late");

    expect((await late.next("sessionError")).code).toBe("runInProgress");
  });

  it("wipes an all-downed party to the hub and takes carried items", async () => {
    const roomCode = await createRoom();
    const alpha = await joinRoom(roomCode, "Alpha");
    await enterDungeon(roomCode, alpha.client);

    const session = server.store.getSession(roomCode)!;
    const player = session.players.get(alpha.joined.playerId)!;
    player.inventory = [
      {
        id: "44444444-4444-4444-8444-444444444444",
        name: "Minor Tonic",
        kind: "consumable", itemId: "minor-tonic", description: "Restores 35 health.", icon: "tonic", useOn: "self",
      },
    ];
    player.health = 0;

    const hub = await alpha.client.nextWhere(
      "stateSnapshot",
      (message) => message.location === "hub",
    );
    expect(hub.players[0]).toMatchObject({ health: 100, inventory: [], bankedItems: [] });
  });

  it("shows the party downed before a wipe moves it home", async () => {
    // A client tells a wipe from an escape by seeing itself downed. The wipe lands in the same tick
    // as the return to the hub, so without a snapshot of its own every wipe read as an escape.
    const roomCode = await createRoom();
    const alpha = await joinRoom(roomCode, "Alpha");
    await enterDungeon(roomCode, alpha.client);

    server.store.getSession(roomCode)!.players.get(alpha.joined.playerId)!.health = 0;

    const downed = await alpha.client.nextWhere(
      "stateSnapshot",
      (message) => message.location === "dungeon" && message.players[0]?.health === 0,
    );
    const hub = await alpha.client.nextWhere(
      "stateSnapshot",
      (message) => message.location === "hub",
    );
    expect(hub.tick).toBeGreaterThan(downed.tick);
  });

  it("lifts, carries, and extracts a downed party member through the exit", async () => {
    const roomCode = await createRoom();
    const alpha = await joinRoom(roomCode, "Alpha");
    const beta = await joinRoom(roomCode, "Beta");
    const hubSession = server.store.getSession(roomCode)!;
    const entrance = hubSession.dungeon.exits[0]!;
    hubSession.players.get(alpha.joined.playerId)!.position = { ...entrance.position };

    alpha.client.send({ type: "setReady", ready: true });
    await alpha.client.next("playerReadyChanged");
    beta.client.send({ type: "setReady", ready: true });
    await alpha.client.next("playerReadyChanged");
    alpha.client.send({ type: "playerInteract", targetId: entrance.id });
    await alpha.client.nextWhere("stateSnapshot", (message) => message.location === "dungeon");

    const session = server.store.getSession(roomCode)!;
    const carrier = session.players.get(alpha.joined.playerId)!;
    const downed = session.players.get(beta.joined.playerId)!;
    downed.health = 0;
    downed.position = { ...carrier.position };
    carrier.stamina = PLAYER_MAX_STAMINA;

    alpha.client.send({ type: "liftPlayer", targetPlayerId: downed.id });
    // The snapshot's own `players` array is the viewer's visible set, which downed party members
    // outside the light may not be in; the carry link itself is authoritative session state, so it
    // is asserted there. The snapshot is only used to synchronize on the tick that applied the lift.
    await alpha.client.nextWhere("stateSnapshot", () => downed.carriedByPlayerId === carrier.id);
    expect(downed.carriedByPlayerId).toBe(carrier.id);
    // The lift's cost, less whatever carry drain a server tick took before this line ran: the
    // tick is on a real timer, and asserting the exact figure failed whenever one slipped in.
    expect(carrier.stamina).toBeLessThanOrEqual(PLAYER_MAX_STAMINA - LIFT_STAMINA_COST);
    expect(carrier.stamina).toBeGreaterThan(PLAYER_MAX_STAMINA - LIFT_STAMINA_COST - 1);

    // Walking the carrier moves the downed party member along with them.
    const beforeMove = carrier.position.x;
    alpha.client.send({ type: "playerMoveIntent", sequence: 1, direction: { x: 1, y: 0 } });
    await alpha.client.nextWhere("stateSnapshot", () => carrier.position.x > beforeMove);
    expect(downed.position).toEqual(carrier.position);

    const exit = session.dungeon.exits[0]!;
    carrier.position = { ...exit.position };
    downed.position = { ...exit.position };

    alpha.client.send({ type: "playerInteract", targetId: exit.id });
    await alpha.client.nextWhere("stateSnapshot", (message) => message.location === "hub");

    // Carried out despite being downed at the moment of extraction: this is the payoff for the
    // carry, distinct from a full revive, which stays out of scope.
    expect(downed.profile.runsEscaped).toBe(1);
    expect(downed.profile.runsLost).toBe(0);
    expect(carrier.carryingPlayerId).toBeNull();
    expect(downed.carriedByPlayerId).toBeNull();
  });

  it("drops a carried player explicitly, and again automatically when the carrier disconnects", async () => {
    const roomCode = await createRoom();
    const alpha = await joinRoom(roomCode, "Alpha");
    const beta = await joinRoom(roomCode, "Beta");
    const hubSession = server.store.getSession(roomCode)!;
    const entrance = hubSession.dungeon.exits[0]!;
    hubSession.players.get(alpha.joined.playerId)!.position = { ...entrance.position };

    alpha.client.send({ type: "setReady", ready: true });
    await alpha.client.next("playerReadyChanged");
    beta.client.send({ type: "setReady", ready: true });
    await alpha.client.next("playerReadyChanged");
    alpha.client.send({ type: "playerInteract", targetId: entrance.id });
    await alpha.client.nextWhere("stateSnapshot", (message) => message.location === "dungeon");

    const session = server.store.getSession(roomCode)!;
    const carrier = session.players.get(alpha.joined.playerId)!;
    const downed = session.players.get(beta.joined.playerId)!;
    downed.health = 0;
    downed.position = { ...carrier.position };

    alpha.client.send({ type: "liftPlayer", targetPlayerId: downed.id });
    await alpha.client.nextWhere("stateSnapshot", () => carrier.carryingPlayerId === downed.id);

    alpha.client.send({ type: "dropCarry" });
    await alpha.client.nextWhere("stateSnapshot", () => carrier.carryingPlayerId === null);
    expect(downed.carriedByPlayerId).toBeNull();

    alpha.client.send({ type: "liftPlayer", targetPlayerId: downed.id });
    await alpha.client.nextWhere("stateSnapshot", () => carrier.carryingPlayerId === downed.id);

    alpha.client.close();
    await new Promise((resolve) => setTimeout(resolve, GRACE_MS + SWEEP_MS * 3));

    expect(downed.carriedByPlayerId).toBeNull();
  });
});

describe("party vault", () => {
  const SCROLL = {
    id: "c1111111-1111-4111-8111-111111111111",
    name: "Scroll of Iron Will",
    kind: "skillScroll",
    skillId: "iron-will",
  } as const;

  /** Puts a player inside the hub's vault room, which the server checks every take and store against. */
  function standAtVault(roomCode: string, playerId: string): void {
    const session = server.store.getSession(roomCode)!;
    const room = session.dungeon.rooms.find((candidate) => candidate.kind === "vault")!;
    session.players.get(playerId)!.position = { x: room.x + 1, y: room.y + 1 };
  }

  it("shows two players the same vault, and one player's withdrawal leaves the other's list", async () => {
    const roomCode = await createRoom();
    const alpha = await joinRoom(roomCode, "Alpha");
    const beta = await joinRoom(roomCode, "Beta");
    standAtVault(roomCode, alpha.joined.playerId);
    standAtVault(roomCode, beta.joined.playerId);
    server.store.getSession(roomCode)!.players.get(alpha.joined.playerId)!.inventory = [{ ...SCROLL }];

    alpha.client.send({ type: "depositVaultItem", itemId: SCROLL.id });
    const [seenByAlpha, seenByBeta] = await Promise.all([
      alpha.client.nextWhere("partyVault", (message) => message.items.length === 1),
      beta.client.nextWhere("partyVault", (message) => message.items.length === 1),
    ]);
    expect(seenByAlpha.items).toEqual([SCROLL]);
    expect(seenByBeta.items).toEqual(seenByAlpha.items);
    // Each joined to an empty vault: a new room starts with nothing in it.
    expect(alpha.client.received("partyVault")[0]?.items).toEqual([]);
    expect(beta.client.received("partyVault")[0]?.items).toEqual([]);

    beta.client.send({ type: "withdrawVaultItem", itemId: SCROLL.id });
    await Promise.all([
      alpha.client.nextWhere("partyVault", (message) => message.items.length === 0),
      beta.client.nextWhere("partyVault", (message) => message.items.length === 0),
    ]);
    const carried = await beta.client.nextWhere("stateSnapshot", (message) =>
      message.players.some((player) => player.id === beta.joined.playerId && player.inventory.length === 1),
    );
    expect(carried.players.find((player) => player.id === beta.joined.playerId)?.inventory).toEqual([SCROLL]);

    // The item is gone, so a second taker is refused rather than handed a copy.
    alpha.client.send({ type: "withdrawVaultItem", itemId: SCROLL.id });
    expect((await alpha.client.next("actionRejected")).reason).toBe("targetMissing");
  });

  it("refuses a withdrawal from outside the vault area", async () => {
    const roomCode = await createRoom();
    const alpha = await joinRoom(roomCode, "Alpha");
    server.store.getSession(roomCode)!.vault.items.push({ ...SCROLL });

    alpha.client.send({ type: "withdrawVaultItem", itemId: SCROLL.id });

    expect((await alpha.client.next("actionRejected")).reason).toBe("outOfRange");
    expect(server.store.getSession(roomCode)!.vault.items).toEqual([SCROLL]);
  });

  it("refuses vault messages from a player still designing their character", async () => {
    const roomCode = await createRoom();
    const { client } = await joinRoom(roomCode, "Alpha", undefined, false);

    client.send({ type: "withdrawVaultItem", itemId: SCROLL.id });

    expect((await client.next("actionRejected")).reason).toBe("notPermitted");
  });
});

describe("handing items over", () => {
  it("hands a tonic between two connected clients, and refuses a full inventory", async () => {
    const roomCode = await createRoom();
    const alpha = await joinRoom(roomCode, "Alpha");
    const beta = await joinRoom(roomCode, "Beta");
    const session = server.store.getSession(roomCode)!;
    const giver = session.players.get(alpha.joined.playerId)!;
    const receiver = session.players.get(beta.joined.playerId)!;
    const tonic = {
      id: "a1111111-1111-4111-8111-111111111111",
      name: "Minor Tonic",
      kind: "consumable" as const,
      itemId: "minor-tonic",
      description: "Restores 35 health.",
      icon: "tonic" as const,
      useOn: "self" as const,
    };
    giver.inventory = [tonic];
    receiver.position = { ...giver.position };

    alpha.client.send({ type: "giveItem", itemId: tonic.id, targetPlayerId: receiver.id });
    // Waits on the snapshot's own content: one built just before the hand-over can arrive after the
    // server state already shows it.
    const snapshot = await beta.client.nextWhere(
      "stateSnapshot",
      (message) => message.players.find((player) => player.id === receiver.id)?.inventory.length === 1,
    );
    expect(giver.inventory).toEqual([]);
    expect(
      snapshot.players.find((player) => player.id === receiver.id)?.inventory.map((item) => item.id),
    ).toEqual([tonic.id]);

    alpha.client.send({ type: "giveItem", itemId: tonic.id, targetPlayerId: receiver.id });
    expect((await alpha.client.next("actionRejected")).reason).toBe("targetMissing");
  });
});

describe("the held item", () => {
  it("swaps over the wire and shows up in both clients' snapshots", async () => {
    const roomCode = await createRoom();
    const alpha = await joinRoom(roomCode, "Alpha");
    const beta = await joinRoom(roomCode, "Beta");
    const session = server.store.getSession(roomCode)!;
    const holder = session.players.get(alpha.joined.playerId)!;
    const sword = {
      id: "a2222222-2222-4222-8222-222222222222",
      name: "Test Sword",
      kind: "weapon" as const,
      itemId: "rusted-sword",
      weaponKind: "melee" as const,
    };
    const bow = {
      id: "a3333333-3333-4333-8333-333333333333",
      name: "Test Bow",
      kind: "weapon" as const,
      itemId: "test-bow",
      weaponKind: "ranged" as const,
    };
    holder.held = sword;
    holder.inventory = [bow];

    alpha.client.send({ type: "swapHeld", itemId: bow.id });
    const snapshot = await beta.client.nextWhere(
      "stateSnapshot",
      (message) => message.players.find((player) => player.id === holder.id)?.held?.id === bow.id,
    );
    const seen = snapshot.players.find((player) => player.id === holder.id);
    expect(seen?.held?.id).toBe(bow.id);
    expect(seen?.inventory.map((item) => item.id)).toEqual([sword.id]);

    alpha.client.send({ type: "swapHeld", itemId: "a4444444-4444-4444-8444-444444444444" });
    expect((await alpha.client.next("actionRejected")).reason).toBe("targetMissing");

    alpha.client.send({ type: "swapHeld", itemId: null });
    await alpha.client.nextWhere(
      "stateSnapshot",
      (message) => message.players.find((player) => player.id === holder.id)?.held === null,
    );
    expect(holder.inventory.map((item) => item.id)).toEqual([sword.id, bow.id]);
  });
});

describe("voice signaling", () => {
  const offer = { kind: "offer", sdp: "v=0 offer" } as const;

  function signal(client: TestClient, targetPlayerId: string, payload: unknown = offer): void {
    client.send({ type: "voiceSignal", targetPlayerId, signal: payload });
  }

  it("relays an offer, answer, and ICE candidates between party members", async () => {
    const roomCode = await createRoom();
    const alpha = await joinRoom(roomCode, "Alpha");
    const beta = await joinRoom(roomCode, "Beta");
    const candidate = {
      kind: "iceCandidate",
      candidate: "candidate:1 1 udp 2122260223 192.0.2.1 54400 typ host",
      sdpMid: "0",
      sdpMLineIndex: 0,
    };

    const gotOffer = beta.client.next("voiceSignalRelay");
    signal(alpha.client, beta.joined.playerId);
    expect(await gotOffer).toEqual({
      type: "voiceSignalRelay",
      fromPlayerId: alpha.joined.playerId,
      signal: offer,
    });

    const gotAnswer = alpha.client.next("voiceSignalRelay");
    signal(beta.client, alpha.joined.playerId, { kind: "answer", sdp: "v=0 answer" });
    expect(await gotAnswer).toEqual({
      type: "voiceSignalRelay",
      fromPlayerId: beta.joined.playerId,
      signal: { kind: "answer", sdp: "v=0 answer" },
    });

    const gotCandidate = alpha.client.next("voiceSignalRelay");
    signal(beta.client, alpha.joined.playerId, candidate);
    expect((await gotCandidate).signal).toEqual(candidate);

    // An end-of-candidates marker has no mid or line index.
    const gotEnd = beta.client.next("voiceSignalRelay");
    signal(alpha.client, beta.joined.playerId, {
      kind: "iceCandidate",
      candidate: "",
      sdpMid: null,
      sdpMLineIndex: null,
    });
    expect((await gotEnd).signal).toMatchObject({ sdpMid: null, sdpMLineIndex: null });

    expect(alpha.client.received("sessionError")).toHaveLength(0);
    expect(beta.client.received("sessionError")).toHaveLength(0);
  });

  it("sends the relay to the target alone, carrying no credentials", async () => {
    const roomCode = await createRoom();
    const alpha = await joinRoom(roomCode, "Alpha");
    const beta = await joinRoom(roomCode, "Beta");
    const gamma = await joinRoom(roomCode, "Gamma");

    const gotOffer = beta.client.next("voiceSignalRelay");
    alpha.client.send({
      type: "voiceSignal",
      targetPlayerId: beta.joined.playerId,
      signal: { ...offer, resumeToken: alpha.joined.resumeToken },
      resumeToken: alpha.joined.resumeToken,
    });
    const relay = await gotOffer;
    const wire = JSON.stringify(relay);

    expect(Object.keys(relay).sort()).toEqual(["fromPlayerId", "signal", "type"]);
    expect(relay.signal).toEqual(offer);
    expect(wire).not.toContain(alpha.joined.resumeToken);
    expect(wire).not.toContain(beta.joined.resumeToken);
    if (alpha.joined.profileSecret) expect(wire).not.toContain(alpha.joined.profileSecret);
    expect(gamma.client.received("voiceSignalRelay")).toHaveLength(0);
    expect(alpha.client.received("voiceSignalRelay")).toHaveLength(0);
  });

  it("rate-limits a flooding sender with a stable error, without touching the party", async () => {
    const roomCode = await createRoom();
    const alpha = await joinRoom(roomCode, "Alpha");
    const beta = await joinRoom(roomCode, "Beta");

    for (let sent = 0; sent <= VOICE_SIGNAL_BURST; sent += 1) {
      signal(alpha.client, beta.joined.playerId);
    }

    expect(await alpha.client.next("sessionError")).toEqual({
      type: "sessionError",
      code: "rateLimited",
      message: "Too many voice signals; slow down",
    });

    // Every signal inside the burst still arrived, and the target's own budget is untouched.
    await vi.waitFor(() =>
      expect(beta.client.received("voiceSignalRelay")).toHaveLength(VOICE_SIGNAL_BURST),
    );
    const answered = alpha.client.next("voiceSignalRelay");
    signal(beta.client, alpha.joined.playerId, { kind: "answer", sdp: "v=0 answer" });
    await expect(answered).resolves.toBeDefined();
  });
});

describe("emotes", () => {
  /** Takes a whole party through the hub gate into the Ember Vault. */
  async function enterDungeonTogether(roomCode: string, clients: TestClient[]) {
    const session = server.store.getSession(roomCode)!;
    const entrance = session.dungeon.exits[0]!;
    for (const client of clients) {
      client.send({ type: "setReady", ready: true });
      await client.next("playerReadyChanged");
    }
    [...session.players.values()][0]!.position = { ...entrance.position };
    clients[0]!.send({ type: "playerInteract", targetId: entrance.id });
    await Promise.all(
      clients.map((client) => client.nextWhere("stateSnapshot", (message) => message.location === "dungeon")),
    );
    return session;
  }

  it("shows an emote to the sender and a party member in sight, in the hub", async () => {
    const roomCode = await createRoom();
    const alpha = await joinRoom(roomCode, "Alpha");
    const beta = await joinRoom(roomCode, "Beta");

    const seenByAlpha = alpha.client.next("playerEmoted");
    const seenByBeta = beta.client.next("playerEmoted");
    alpha.client.send({ type: "emote", kind: "wave" });

    for (const emoted of [await seenByAlpha, await seenByBeta]) {
      expect(emoted).toMatchObject({ type: "playerEmoted", playerId: alpha.joined.playerId, kind: "wave" });
      expect(Object.keys(emoted).sort()).toEqual(["at", "kind", "playerId", "type"]);
    }
  });

  it("reaches only the party members who can see the emoter, in a dungeon", async () => {
    const roomCode = await createRoom();
    const alpha = await joinRoom(roomCode, "Alpha");
    const beta = await joinRoom(roomCode, "Beta");
    const gamma = await joinRoom(roomCode, "Gamma");
    const session = await enterDungeonTogether(roomCode, [alpha.client, beta.client, gamma.client]);

    // The same layout as `tests/server/emotes.test.ts`: Alpha unlit in the far corner of the top
    // corridor, Beta beside them with a torch, Gamma back at the spawn.
    const place = (playerId: string, position: { x: number; y: number }, carryingTorch: boolean) => {
      const player = session.players.get(playerId)!;
      player.position = position;
      player.carryingTorch = carryingTorch;
    };
    place(alpha.joined.playerId, at(14, 1), false);
    place(beta.joined.playerId, at(13, 1), true);
    place(gamma.joined.playerId, at(2, 2), true);
    await gamma.client.nextWhere(
      "stateSnapshot",
      (message) => !message.players.some((player) => player.id === alpha.joined.playerId),
    );

    const seenByAlpha = alpha.client.next("playerEmoted");
    const seenByBeta = beta.client.next("playerEmoted");
    alpha.client.send({ type: "emote", kind: "followMe" });

    expect((await seenByAlpha).kind).toBe("followMe");
    expect((await seenByBeta).playerId).toBe(alpha.joined.playerId);
    // A later message from Alpha's side proves Gamma's socket had its chance to receive one.
    beta.client.send({ type: "setReady", ready: false });
    await gamma.client.next("playerReadyChanged");
    expect(gamma.client.received("playerEmoted")).toEqual([]);
  });

  it("refuses an unknown kind without dropping the connection", async () => {
    const roomCode = await createRoom();
    const { client } = await joinRoom(roomCode, "Alpha");

    client.send({ type: "emote", kind: "flex" });
    expect((await client.next("sessionError")).code).toBe("invalidMessage");

    client.send({ type: "emote", kind: "wave" });
    expect((await client.next("playerEmoted")).kind).toBe("wave");
  });

  it("refuses an emote before joining", async () => {
    const client = await TestClient.connect();
    client.send({ type: "emote", kind: "wave" });

    expect((await client.next("sessionError")).code).toBe("notInSession");
  });

  it("refuses an emote from a player still designing a character", async () => {
    const roomCode = await createRoom();
    const alpha = await joinRoom(roomCode, "Alpha", undefined, false);
    const beta = await joinRoom(roomCode, "Beta");

    alpha.client.send({ type: "emote", kind: "wave" });
    expect(await alpha.client.next("actionRejected")).toMatchObject({ sequence: null, reason: "notPermitted" });
    expect(alpha.client.received("playerEmoted")).toEqual([]);
    expect(beta.client.received("playerEmoted")).toEqual([]);
  });

  it("lets a downed player call for help and nothing else", async () => {
    const roomCode = await createRoom();
    const alpha = await joinRoom(roomCode, "Alpha");
    const beta = await joinRoom(roomCode, "Beta");
    const session = await enterDungeonTogether(roomCode, [alpha.client, beta.client]);
    session.players.get(alpha.joined.playerId)!.health = 0;
    // Beta stays up beside Alpha with a torch, so the party is not wiped home mid-test and Beta can
    // see who is calling.
    const rescuer = session.players.get(beta.joined.playerId)!;
    rescuer.position = { ...session.players.get(alpha.joined.playerId)!.position };
    rescuer.carryingTorch = true;

    alpha.client.send({ type: "emote", kind: "wave" });
    expect(await alpha.client.next("actionRejected")).toMatchObject({ reason: "notPermitted" });

    const help = beta.client.next("playerEmoted");
    alpha.client.send({ type: "emote", kind: "help" });
    expect(await help).toMatchObject({ playerId: alpha.joined.playerId, kind: "help" });
  });

  it("rate-limits to one a second, broadcasting nothing over the limit", async () => {
    const roomCode = await createRoom();
    const alpha = await joinRoom(roomCode, "Alpha");
    const beta = await joinRoom(roomCode, "Beta");

    const wave = beta.client.next("playerEmoted");
    const limited = alpha.client.next("sessionError");
    alpha.client.send({ type: "emote", kind: "wave" });
    alpha.client.send({ type: "emote", kind: "cheer" });

    expect(await limited).toEqual({
      type: "sessionError",
      code: "rateLimited",
      message: "Too many emotes; slow down",
    });
    expect((await wave).kind).toBe("wave");
    // Beta's own budget is untouched by Alpha's flood.
    const own = beta.client.next("playerEmoted");
    beta.client.send({ type: "emote", kind: "bow" });
    expect((await own).playerId).toBe(beta.joined.playerId);
    expect(beta.client.received("playerEmoted").map((emoted) => emoted.kind)).toEqual(["wave", "bow"]);
    expect(alpha.client.received("playerEmoted").map((emoted) => emoted.kind)).not.toContain("cheer");
  });
});

describe("map discovery over the wire", () => {
  const tilesIn = (map: { discovered: { tiles: string }[] }) =>
    map.discovered.reduce((total, run) => total + run.tiles.length, 0);

  it("sends a baseline first, then only deltas, and a new baseline on reconnect and for a new world", async () => {
    const roomCode = await createRoom();
    const alpha = await joinRoom(roomCode, "Alpha");

    const baseline = await alpha.client.firstAfter(alpha.joined, "stateSnapshot");
    expect(baseline.dungeon.map).toMatchObject({ id: "hub", reset: true });
    expect(tilesIn(baseline.dungeon.map)).toBeGreaterThan(0);

    const steady = await alpha.client.firstAfter(baseline, "stateSnapshot");
    expect(steady.dungeon.map.reset).toBe(false);
    expect(steady.dungeon.map.discovered).toEqual([]);

    // Dropping and resuming gives a client with an empty cache, so it must get a baseline again.
    alpha.client.close();
    const resumed = await joinRoom(roomCode, "Alpha", alpha.joined.resumeToken);
    const rebased = await resumed.client.firstAfter(resumed.joined, "stateSnapshot");
    expect(rebased.dungeon.map).toMatchObject({ id: "hub", reset: true });
    expect(tilesIn(rebased.dungeon.map)).toBeGreaterThan(0);
    // Light is not a delta, so the first snapshot on the new socket already says what is lit.
    expect(rebased.dungeon.map.lit).toEqual(baseline.dungeon.map.lit);
    expect(rebased.dungeon.map.lit.length).toBeGreaterThan(0);

    // Entering the run rebuilds the world, which restarts the client's geometry.
    const dungeon = await enterDungeon(roomCode, resumed.client);
    expect(dungeon.dungeon.map).toMatchObject({ id: "ember-vault", reset: true });
    const after = await resumed.client.nextWhere(
      "stateSnapshot",
      (message) => message.location === "dungeon" && message.tick > dungeon.tick,
    );
    expect(after.dungeon.map.reset).toBe(false);
  });
});

describe("disconnect, reconnect, and timeout", () => {
  it("holds the slot and reports the drop rather than a departure", async () => {
    const roomCode = await createRoom();
    const alpha = await joinRoom(roomCode, "Alpha");
    const beta = await joinRoom(roomCode, "Beta");

    const dropped = beta.client.next("playerConnectionChanged");
    alpha.client.close();

    expect((await dropped).connected).toBe(false);
    expect(beta.client.received("playerLeft")).toHaveLength(0);

    const snapshot = await beta.client.next("stateSnapshot");
    expect(snapshot.players).toHaveLength(2);
    expect(snapshot.players.find((p) => p.id === alpha.joined.playerId)?.connected).toBe(false);
  });

  it("restores identity and game state on reconnect", async () => {
    const roomCode = await createRoom();
    const alpha = await joinRoom(roomCode, "Alpha");
    const beta = await joinRoom(roomCode, "Beta");

    alpha.client.send({ type: "setReady", ready: true });
    await beta.client.next("playerReadyChanged");

    const dropped = beta.client.next("playerConnectionChanged");
    alpha.client.close();
    await dropped;

    const returning = beta.client.next("playerConnectionChanged");
    const resumed = await joinRoom(roomCode, "Alpha", alpha.joined.resumeToken);

    expect(resumed.joined.resumed).toBe(true);
    expect(resumed.joined.playerId).toBe(alpha.joined.playerId);
    expect(resumed.joined.players).toHaveLength(2);
    expect(resumed.joined.players.find((p) => p.id === alpha.joined.playerId)?.ready).toBe(true);
    expect((await returning).connected).toBe(true);
  });

  it("releases the slot once the grace window expires", async () => {
    const roomCode = await createRoom();
    const alpha = await joinRoom(roomCode, "Alpha");
    const beta = await joinRoom(roomCode, "Beta");

    const dropped = beta.client.next("playerConnectionChanged");
    alpha.client.close();
    await dropped;

    const left = await beta.client.next("playerLeft", 3000);
    expect(left.reason).toBe("timedOut");
    expect(left.playerId).toBe(alpha.joined.playerId);

    const snapshot = await beta.client.next("stateSnapshot");
    expect(snapshot.players).toHaveLength(1);
  });
});

describe("leaving", () => {
  it("frees the slot immediately and tells the party", async () => {
    const roomCode = await createRoom();
    const alpha = await joinRoom(roomCode, "Alpha");
    const beta = await joinRoom(roomCode, "Beta");

    const left = alpha.client.next("playerLeft");
    beta.client.send({ type: "leaveSession" });

    expect((await left).reason).toBe("left");

    const snapshot = await alpha.client.next("stateSnapshot");
    expect(snapshot.players).toHaveLength(1);
  });
});

describe("progression state", () => {
  function sessionPlayer(roomCode: string, playerId: string) {
    const session = server.store.getSession(roomCode);
    const player = session?.players.get(playerId);
    if (!session || !player) throw new Error("expected session and player");
    return { session, player };
  }

  it("sends the catalog and an empty state to the joining owner", async () => {
    const roomCode = await createRoom();
    const alpha = await joinRoom(roomCode, "Alpha");

    await alpha.client.nextWhere("stateSnapshot", () => true);
    const received = alpha.client.received("progressionCatalog")[0];
    expect(received?.skills.map((skill) => skill.id)).toContain("iron-will");
    expect(received?.upgrades.map((upgrade) => upgrade.id)).toContain("iron-will-steeled");

    const state = alpha.client.received("progressionUpdated")[0];
    expect(state).toMatchObject({
      unlockedSkillIds: [],
      runSkillIds: [],
      activeSkillIds: [],
      activeUpgradeIds: [],
    });
  });

  it("tracks a provisional scroll, then banks it on extraction", async () => {
    const roomCode = await createRoom();
    const alpha = await joinRoom(roomCode, "Alpha");
    await enterDungeon(roomCode, alpha.client);
    const { session, player } = sessionPlayer(roomCode, alpha.joined.playerId);

    expect(learnSkill(session, player, "iron-will")).toBe(true);
    const provisional = await alpha.client.nextWhere("progressionUpdated", (m) =>
      m.runSkillIds.includes("iron-will"),
    );
    expect(provisional.unlockedSkillIds).toEqual([]);
    expect(provisional.activeSkillIds).toEqual(["iron-will"]);

    returnToHub(session, true);
    const banked = await alpha.client.nextWhere("progressionUpdated", (m) =>
      m.unlockedSkillIds.includes("iron-will"),
    );
    expect(banked.runSkillIds).toEqual([]);
    expect(banked.activeSkillIds).toEqual(["iron-will"]);
  });

  it("drops a provisional scroll when the run is lost", async () => {
    const roomCode = await createRoom();
    const alpha = await joinRoom(roomCode, "Alpha");
    await enterDungeon(roomCode, alpha.client);
    const { session, player } = sessionPlayer(roomCode, alpha.joined.playerId);

    learnSkill(session, player, "torchbearer");
    await alpha.client.nextWhere("progressionUpdated", (m) =>
      m.runSkillIds.includes("torchbearer"),
    );

    returnToHub(session, false);
    const lost = await alpha.client.nextWhere(
      "progressionUpdated",
      (m) => m.runSkillIds.length === 0,
    );
    expect(lost.unlockedSkillIds).toEqual([]);
    expect(lost.activeSkillIds).toEqual([]);
  });

  it("never sends one player's progression to another", async () => {
    const roomCode = await createRoom();
    const alpha = await joinRoom(roomCode, "Alpha");
    const beta = await joinRoom(roomCode, "Beta");
    const { session, player } = sessionPlayer(roomCode, alpha.joined.playerId);

    // Hub learning is permanent at once, so alpha's own message is the only one that may change.
    learnSkill(session, player, "iron-will");
    await alpha.client.nextWhere("progressionUpdated", (m) =>
      m.unlockedSkillIds.includes("iron-will"),
    );
    await beta.client.next("stateSnapshot");
    await beta.client.next("stateSnapshot");

    for (const message of beta.client.received("progressionUpdated")) {
      expect(message.unlockedSkillIds).toEqual([]);
      expect(message.activeSkillIds).toEqual([]);
    }
    expect(beta.client.received("progressionCatalog")).toHaveLength(1);
  });

  it("resends the full state to a reconnecting owner", async () => {
    const roomCode = await createRoom();
    const alpha = await joinRoom(roomCode, "Alpha");
    const { session, player } = sessionPlayer(roomCode, alpha.joined.playerId);
    learnSkill(session, player, "lever-sense");
    await alpha.client.nextWhere("progressionUpdated", (m) =>
      m.unlockedSkillIds.includes("lever-sense"),
    );

    alpha.client.close();
    const back = await joinRoom(roomCode, "Alpha", alpha.joined.resumeToken);
    expect(back.joined.resumed).toBe(true);
    // The catalog and the owner's progression follow `sessionJoined` on the wire, so they may not
    // have arrived when `joinRoom` resolves.
    await vi.waitFor(() => {
      expect(back.client.received("progressionCatalog")).toHaveLength(1);
      expect(back.client.received("progressionUpdated")[0]?.unlockedSkillIds).toEqual([
        "lever-sense",
      ]);
    });
  });
});

describe("seats", () => {
  it("sits one player on a bench where the other sees it, and a move stands them up for both", async () => {
    const roomCode = await createRoom();
    const alpha = await joinRoom(roomCode, "Alpha");
    const beta = await joinRoom(roomCode, "Beta");
    const session = server.store.getSession(roomCode)!;
    const sitter = session.players.get(alpha.joined.playerId)!;

    // Seats travel with map discovery, so a client can find one to sit on. They arrive once, on the
    // baseline that may already be in the inbox.
    await vi.waitFor(() =>
      expect(alpha.client.received("stateSnapshot").some((snapshot) => snapshot.dungeon.map.seats)).toBe(true),
    );
    const seats = alpha.client.received("stateSnapshot").flatMap((snapshot) => snapshot.dungeon.map.seats ?? []);
    const seat = seats.find((candidate) => candidate.facing === "south")!;
    sitter.position = { x: seat.x, y: Math.round(seat.y) + 1 };

    alpha.client.send({ type: "playerInteract", targetId: seat.id });
    const seated = await beta.client.nextWhere(
      "stateSnapshot",
      (snapshot) => snapshot.players.find((player) => player.id === sitter.id)?.seatId === seat.id,
    );
    expect(seated.players.find((player) => player.id === sitter.id)?.position).toEqual({ x: seat.x, y: seat.y });
    await alpha.client.nextWhere(
      "stateSnapshot",
      (snapshot) => snapshot.players.find((player) => player.id === sitter.id)?.seatId === seat.id,
    );

    // A second player cannot take a seat that is in use.
    const other = session.players.get(beta.joined.playerId)!;
    other.position = { x: seat.x + 0.5, y: Math.round(seat.y) + 1 };
    beta.client.send({ type: "playerInteract", targetId: seat.id });
    expect((await beta.client.next("actionRejected")).reason).toBe("blocked");

    alpha.client.send({ type: "playerMoveIntent", sequence: 1, direction: { x: 0, y: -1 } });
    for (const client of [alpha.client, beta.client]) {
      const stood = await client.nextWhere(
        "stateSnapshot",
        (snapshot) => snapshot.players.find((player) => player.id === sitter.id)?.seatId === null,
      );
      const seen = stood.players.find((player) => player.id === sitter.id)!;
      // Up onto the floor in front of the bench, even though the step pointed into it.
      expect(seen.position.y).toBeGreaterThan(seat.y);
    }
  });
});

describe("ready plates", () => {
  it("readies a player who stands on a plate, lights it for both clients, and unreadies them off it", async () => {
    const roomCode = await createRoom();
    const alpha = await joinRoom(roomCode, "Alpha");
    const beta = await joinRoom(roomCode, "Beta");
    const session = server.store.getSession(roomCode)!;
    const stander = session.players.get(alpha.joined.playerId)!;
    const clients = [alpha.client, beta.client];
    const readyChanges = (client: TestClient) =>
      client.received("playerReadyChanged").filter((message) => message.playerId === stander.id);
    const lastSeenPlate = (client: TestClient) =>
      client
        .received("stateSnapshot")
        .at(-1)
        ?.players.find((player) => player.id === stander.id)?.readyPlateId;

    await vi.waitFor(() =>
      expect(alpha.client.received("stateSnapshot").some((snapshot) => snapshot.dungeon.map.readyPlates)).toBe(true),
    );
    const plate = alpha.client
      .received("stateSnapshot")
      .flatMap((snapshot) => snapshot.dungeon.map.readyPlates ?? [])[0]!;

    // Placed straight onto the plate; the server decides on its next tick.
    stander.position = { x: plate.x, y: plate.y };
    for (const client of clients) {
      // One of two is not the whole party, so this carries no cue.
      await vi.waitFor(() =>
        expect(readyChanges(client)).toEqual([{ type: "playerReadyChanged", playerId: stander.id, ready: true }]),
      );
      await vi.waitFor(() => expect(lastSeenPlate(client)).toBe(plate.id));
    }

    stander.position = { x: plate.x, y: plate.y + 4 };
    for (const client of clients) {
      await vi.waitFor(() => expect(readyChanges(client).at(-1)?.ready).toBe(false));
      await vi.waitFor(() => expect(lastSeenPlate(client)).toBeNull());
    }
  });

  it("cues both clients when the last plate fills", async () => {
    const roomCode = await createRoom();
    const alpha = await joinRoom(roomCode, "Alpha");
    const beta = await joinRoom(roomCode, "Beta");
    const session = server.store.getSession(roomCode)!;
    const [first, second] = session.dungeon.map.readyPlates!;

    session.players.get(alpha.joined.playerId)!.position = { x: first!.x, y: first!.y };
    await vi.waitFor(() => expect(session.players.get(alpha.joined.playerId)!.ready).toBe(true));
    session.players.get(beta.joined.playerId)!.position = { x: second!.x, y: second!.y };
    for (const client of [alpha.client, beta.client]) {
      await vi.waitFor(() =>
        expect(client.received("playerReadyChanged").at(-1)).toEqual({
          type: "playerReadyChanged",
          playerId: beta.joined.playerId,
          ready: true,
          partyReady: true,
        }),
      );
    }
  });
});
