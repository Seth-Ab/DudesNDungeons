import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
} from "../../src/shared/constants/game.js";
import { PLAYER_STEP_DISTANCE } from "../../src/shared/game/movement.js";
import { createGameServer, type GameServer } from "../../src/server/gameServer.js";
import { SessionStore } from "../../src/server/sessions/sessionStore.js";
import type { ServerMessage } from "../../src/shared/protocol/index.js";

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

/** Joins and returns the private `sessionJoined`, which is where the resume token lives. */
async function joinRoom(roomCode: string, name: string, resumeToken?: string) {
  const client = await TestClient.connect();
  client.join(roomCode, name, resumeToken);
  const joined = await client.next("sessionJoined");
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

  it("issues room codes from the unambiguous alphabet", async () => {
    expect(await createRoom()).toMatch(/^[BCDFGHJKLMNPQRSTVWXYZ23456789]{6}$/);
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

    expect((await arrival).player.name).toBe("Beta");
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
    const { client, joined } = await joinRoom(roomCode, "Alpha");

    // Three UTF-8 bytes per character: the most bytes a schema-valid signal can occupy, and more
    // than a limit counted in characters would allow.
    const frame = JSON.stringify({
      type: "voiceSignal",
      targetPlayerId: joined.playerId,
      signal: { kind: "offer", sdp: "€".repeat(MAX_VOICE_SIGNAL_LENGTH) },
    });
    expect(Buffer.byteLength(frame)).toBeGreaterThan(MAX_CLIENT_MESSAGE_CHARS);
    expect(Buffer.byteLength(frame)).toBeLessThanOrEqual(MAX_CLIENT_MESSAGE_BYTES);

    client.sendRaw(frame);

    // Relay is not built yet, so passing validation is what reaches this reply.
    expect((await client.next("sessionError")).code).toBe("notImplemented");
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
        kind: "tonic",
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

  it("refuses a resume token whose slot is still connected", async () => {
    const roomCode = await createRoom();
    const alpha = await joinRoom(roomCode, "Alpha");

    const impostor = await TestClient.connect();
    impostor.join(roomCode, "Impostor", alpha.joined.resumeToken);

    expect((await impostor.next("sessionError")).code).toBe("alreadyInSession");
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

  it("hands a timed-out token a brand new slot", async () => {
    const roomCode = await createRoom();
    const alpha = await joinRoom(roomCode, "Alpha");
    const beta = await joinRoom(roomCode, "Beta");

    alpha.client.close();
    await beta.client.next("playerLeft", 3000);

    const revenant = await joinRoom(roomCode, "Alpha", alpha.joined.resumeToken);

    expect(revenant.joined.resumed).toBe(false);
    expect(revenant.joined.playerId).not.toBe(alpha.joined.playerId);
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

  it("stops a party at the four-player cap", async () => {
    const roomCode = await createRoom();
    await joinRoom(roomCode, "One");
    await joinRoom(roomCode, "Two");
    await joinRoom(roomCode, "Three");
    await joinRoom(roomCode, "Four");

    const fifth = await TestClient.connect();
    fifth.join(roomCode, "Five");

    expect((await fifth.next("sessionError")).code).toBe("sessionFull");
  });

  it("keeps two dungeons independent", async () => {
    const first = await createRoom();
    const second = await createRoom();
    const alpha = await joinRoom(first, "Alpha");
    await joinRoom(second, "Beta");

    const snapshot = await alpha.client.next("stateSnapshot");

    expect(snapshot.players).toHaveLength(1);
    expect(snapshot.players[0]?.name).toBe("Alpha");
  });
});
