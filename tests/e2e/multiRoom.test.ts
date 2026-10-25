import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { PROTOCOL_VERSION } from "../../src/shared/constants/game.js";
import { createGameServer, type GameServer } from "../../src/server/gameServer.js";
import { createFileRoomSaveStorage } from "../../src/server/saves/fileRoomSaveStorage.js";
import { RoomSaveStore } from "../../src/server/saves/roomSaveStore.js";
import { SessionStore } from "../../src/server/sessions/sessionStore.js";
import type { ServerMessage } from "../../src/shared/protocol/index.js";

// One server hosting two rooms at once, driven over real sockets: nothing one room does may show up
// in the other. Waits are on effects, never on delays, so the suite does not depend on timing.

const TICK_MS = 20;
const LOOK = { body: "girl", skinTone: "tan", hairStyle: "bun", hairColor: "silver" } as const;

let server: GameServer;
let saves: RoomSaveStore;
let baseUrl: string;
let wsUrl: string;
let directory: string;
const clients: Client[] = [];

/** A bare socket that buffers everything the server sends it. */
class Client {
  readonly inbox: ServerMessage[] = [];
  readonly #ws: WebSocket;

  private constructor(ws: WebSocket) {
    this.#ws = ws;
    ws.on("message", (data) => this.inbox.push(JSON.parse(data.toString()) as ServerMessage));
  }

  static async connect(): Promise<Client> {
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });
    const client = new Client(ws);
    clients.push(client);
    return client;
  }

  send(message: unknown): void {
    this.#ws.send(JSON.stringify(message));
  }

  close(): void {
    this.#ws.close();
  }

  received<T extends ServerMessage["type"]>(type: T): Extract<ServerMessage, { type: T }>[] {
    return this.inbox.filter((message): message is Extract<ServerMessage, { type: T }> => message.type === type);
  }

  async waitFor<T extends ServerMessage["type"]>(
    type: T,
    matches: (message: Extract<ServerMessage, { type: T }>) => boolean = () => true,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    return eventually(() =>
      this.inbox.find(
        (message): message is Extract<ServerMessage, { type: T }> =>
          message.type === type && matches(message as Extract<ServerMessage, { type: T }>),
      ),
    );
  }

  /** Waits for a message that arrives after this call, not one already in the inbox. */
  async next<T extends ServerMessage["type"]>(
    type: T,
    matches: (message: Extract<ServerMessage, { type: T }>) => boolean = () => true,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    const from = this.inbox.length;
    return eventually(() =>
      this.inbox
        .slice(from)
        .find(
          (message): message is Extract<ServerMessage, { type: T }> =>
            message.type === type && matches(message as Extract<ServerMessage, { type: T }>),
        ),
    );
  }
}

type Member = Awaited<ReturnType<typeof joinRoom>>;

/** Polls until `read` returns something, so a test waits on the effect rather than on a delay. */
async function eventually<T>(read: () => T | undefined | null | false, timeoutMs = 3000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error("timed out waiting for the server");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function createRoom(): Promise<string> {
  const response = await fetch(`${baseUrl}/sessions`, { method: "POST" });
  return ((await response.json()) as { roomCode: string }).roomCode;
}

/** Joins (or resumes with a token) and designs a character, waiting until a snapshot shows them spawned. */
async function joinRoom(roomCode: string, playerName: string, resumeToken?: string) {
  const client = await Client.connect();
  client.send({ type: "joinSession", protocolVersion: PROTOCOL_VERSION, roomCode, playerName, resumeToken });
  const joined = await client.waitFor("sessionJoined");
  if (joined.needsAppearance) client.send({ type: "setAppearance", appearance: LOOK });
  await client.waitFor("stateSnapshot", (snapshot) =>
    snapshot.players.some((player) => player.id === joined.playerId && player.appearance !== null),
  );
  return { client, joined, roomCode, name: playerName };
}

/** Readies the party and walks the first member through the hub entrance. */
async function enterDungeon(roomCode: string, members: Member[]) {
  for (const { client } of members) client.send({ type: "setReady", ready: true });
  const session = server.store.getSession(roomCode);
  const entrance = session?.dungeon.exits[0];
  const first = members[0];
  if (!session || !entrance || !first) throw new Error("expected a hub entrance and a player");

  await eventually(() => [...session.players.values()].every((player) => player.ready));
  const player = session.players.get(first.joined.playerId);
  if (player) player.position = { ...entrance.position };
  first.client.send({ type: "playerInteract", targetId: entrance.id });
  await Promise.all(
    members.map(({ client }) => client.next("stateSnapshot", (snapshot) => snapshot.location === "dungeon")),
  );
  return session;
}

/**
 * Fails, naming the message type and the room, if anything this client was sent mentions a player
 * of another room. Player ids are the one field every room-scoped message carries.
 */
function expectNoLeakFrom(client: Client, foreign: Member[], label: string): void {
  const foreignIds = foreign.map((member) => member.joined.playerId);
  for (const message of client.inbox) {
    const text = JSON.stringify(message);
    for (const id of foreignIds) {
      if (text.includes(id)) throw new Error(`${label}: "${message.type}" leaked foreign player ${id}`);
    }
  }
}

/**
 * Proves a room has delivered everything queued ahead of now: a ready toggle comes back to every
 * member, and sockets deliver in order, so anything a leak sent first would already be in the inbox.
 */
async function drain(members: Member[]): Promise<void> {
  const [first] = members;
  if (!first) return;
  const ready = !server.store.getSession(first.roomCode)?.players.get(first.joined.playerId)?.ready;
  const seen = members.map(({ client }) => client.next("playerReadyChanged"));
  first.client.send({ type: "setReady", ready });
  await Promise.all(seen);
}

async function twoRooms() {
  const roomA = await createRoom();
  const roomB = await createRoom();
  const a1 = await joinRoom(roomA, "Alpha");
  const a2 = await joinRoom(roomA, "Beta");
  // The same names as room A: a name only has to be unique within its own room.
  const b1 = await joinRoom(roomB, "Alpha");
  const b2 = await joinRoom(roomB, "Beta");
  return { roomA, roomB, a: [a1, a2], b: [b1, b2] };
}

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "dnd-multi-room-"));
  saves = new RoomSaveStore(createFileRoomSaveStorage(join(directory, "rooms.json")));
  server = createGameServer({
    store: new SessionStore({ saves, dungeon: { dungeonId: "ember-vault" } }),
    tickIntervalMs: TICK_MS,
    sweepIntervalMs: 10_000,
    autosaveIntervalMs: 30,
    log: false,
  });
  const address = await server.listen(0, "127.0.0.1");
  baseUrl = `http://127.0.0.1:${address.port}`;
  wsUrl = `ws://127.0.0.1:${address.port}`;
});

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  await server.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("two rooms on one server", () => {
  it("admits the same player name in both rooms under different identities", async () => {
    const { a, b } = await twoRooms();

    expect(a[0]!.joined.playerId).not.toBe(b[0]!.joined.playerId);
    expect(a[0]!.joined.resumeToken).not.toBe(b[0]!.joined.resumeToken);
    expect(a[0]!.joined.roomCode).not.toBe(b[0]!.joined.roomCode);
  });

  it("keeps each room's roster and snapshots to its own players", async () => {
    const { a, b } = await twoRooms();
    await drain(a);
    await drain(b);

    for (const [members, other, label] of [
      [a, b, "room A"],
      [b, a, "room B"],
    ] as const) {
      const ownIds = members.map((member) => member.joined.playerId).sort();
      for (const { client } of members) {
        const roster = client.received("partyRoster").at(-1);
        expect(roster?.members.map((member) => member.playerId).sort(), `${label} partyRoster.members`).toEqual(ownIds);
        const snapshot = client.received("stateSnapshot").at(-1);
        expect(snapshot?.players.map((player) => player.id).sort(), `${label} stateSnapshot.players`).toEqual(ownIds);
        expectNoLeakFrom(client, other, label);
      }
    }
  });

  it("does not move one room's players when the other room moves", async () => {
    const { a, b } = await twoRooms();
    const before = b.map(({ client, joined }) => client.received("stateSnapshot").at(-1)?.players.find((p) => p.id === joined.playerId)?.position);
    const startX = a[0]!.client.received("stateSnapshot").at(-1)!.players.find((p) => p.id === a[0]!.joined.playerId)!.position.x;

    a[0]!.client.send({ type: "playerMoveIntent", sequence: 1, direction: { x: 1, y: 0 } });
    await a[1]!.client.next("stateSnapshot", (snapshot) =>
      (snapshot.players.find((p) => p.id === a[0]!.joined.playerId)?.position.x ?? startX) > startX,
    );
    await drain(b);

    b.forEach(({ client, joined }, index) => {
      const position = client.received("stateSnapshot").at(-1)?.players.find((p) => p.id === joined.playerId)?.position;
      expect(position, `room B player ${index} stateSnapshot.players[].position`).toEqual(before[index]);
      expectNoLeakFrom(client, a, "room B");
    });
  });

  it("leaves room B in its dungeon, untouched, when room A enters and then ends its run", async () => {
    const { roomA, roomB, a, b } = await twoRooms();
    const sessionB = await enterDungeon(roomB, b);
    const sessionA = await enterDungeon(roomA, a);
    const healthB = [...sessionB.players.values()].map((player) => player.health);

    // Room A's whole party goes down: a wipe sends it home.
    for (const player of sessionA.players.values()) player.health = 0;
    await Promise.all(a.map(({ client }) => client.next("stateSnapshot", (snapshot) => snapshot.location === "hub")));
    await drain(b);

    expect(sessionA.location).toBe("hub");
    expect(sessionB.location).toBe("dungeon");
    expect([...sessionB.players.values()].map((player) => player.health)).toEqual(healthB);
    for (const { client } of b) {
      const last = client.received("stateSnapshot").at(-1);
      expect(last?.location, "room B stateSnapshot.location").toBe("dungeon");
      expectNoLeakFrom(client, a, "room B");
    }
  });

  it("relays voice and emotes inside a room only, and refuses a signal aimed at another room", async () => {
    const { a, b } = await twoRooms();
    const offer = { kind: "offer", sdp: "v=0 offer" } as const;

    // Inside the room it still works.
    const relayed = a[1]!.client.next("voiceSignalRelay");
    a[0]!.client.send({ type: "voiceSignal", targetPlayerId: a[1]!.joined.playerId, signal: offer });
    expect((await relayed).fromPlayerId).toBe(a[0]!.joined.playerId);

    // Aimed at a player who is only in room B, it reaches no one.
    const refused = a[0]!.client.next("sessionError");
    a[0]!.client.send({ type: "voiceSignal", targetPlayerId: b[0]!.joined.playerId, signal: offer });
    await refused;

    const emoted = a[1]!.client.next("playerEmoted");
    a[0]!.client.send({ type: "emote", kind: "wave" });
    expect((await emoted).playerId).toBe(a[0]!.joined.playerId);

    await drain(b);
    for (const { client } of b) {
      expect(client.received("voiceSignalRelay"), "room B voiceSignalRelay").toEqual([]);
      expect(client.received("playerEmoted"), "room B playerEmoted").toEqual([]);
      expectNoLeakFrom(client, a, "room B");
    }
  });

  it("is undisturbed by a disconnect and a rejoin in the other room", async () => {
    const { roomA, a, b } = await twoRooms();
    await drain(b);
    const quiet = b.map(({ client }) => client.inbox.length);

    const dropped = a[1]!.client.next("playerConnectionChanged", (message) => !message.connected);
    a[0]!.client.close();
    await dropped;
    const resumed = await joinRoom(roomA, "Alpha", a[0]!.joined.resumeToken);
    expect(resumed.joined.resumed).toBe(true);
    expect(resumed.joined.playerId).toBe(a[0]!.joined.playerId);

    await drain(b);
    b.forEach(({ client }, index) => {
      const added = client.inbox.slice(quiet[index]).map((message) => message.type);
      const membership = added.filter((type) => ["playerJoined", "playerLeft", "playerConnectionChanged", "partyRoster"].includes(type));
      expect(membership, `room B member ${index} membership messages`).toEqual([]);
      expectNoLeakFrom(client, a, "room B");
    });
  });

  it("keeps a room running after the other room's sockets all close", async () => {
    const { roomA, roomB, a, b } = await twoRooms();

    for (const { client } of a) client.close();
    await eventually(() => [...(server.store.getSession(roomA)?.players.values() ?? [])].every((player) => !player.connected));

    const startX = b[0]!.client.received("stateSnapshot").at(-1)!.players.find((p) => p.id === b[0]!.joined.playerId)!.position.x;
    b[0]!.client.send({ type: "playerMoveIntent", sequence: 1, direction: { x: 1, y: 0 } });
    const moved = await b[1]!.client.next("stateSnapshot", (snapshot) =>
      (snapshot.players.find((p) => p.id === b[0]!.joined.playerId)?.position.x ?? startX) > startX,
    );
    expect(moved.players).toHaveLength(2);
    expect(server.store.getSession(roomB)?.players.size).toBe(2);
    for (const { client } of b) {
      expect(client.received("playerConnectionChanged"), "room B playerConnectionChanged").toEqual([]);
      expect(client.received("playerLeft"), "room B playerLeft").toEqual([]);
    }
  });

  it("saves each live room to its own entry, and saving one leaves the other unchanged", async () => {
    const { roomA, roomB, a } = await twoRooms();
    await enterDungeon(roomA, a);

    const saveA = await eventually(() => saves.get(roomA)?.run && saves.get(roomA));
    const saveB = await eventually(() => saves.get(roomB));
    expect(saveA.members.map((member) => member.name).sort(), "room A save members").toEqual(["Alpha", "Beta"]);
    expect(saveA.run?.players, "room A save run.players").toHaveLength(2);
    expect(saveB.members.map((member) => member.name).sort(), "room B save members").toEqual(["Alpha", "Beta"]);
    expect(saveB.run, "room B save run").toBeNull();

    // Both are in the file, each under its own code.
    const onDisk = await eventually(() => {
      const read = createFileRoomSaveStorage(join(directory, "rooms.json")).read();
      return read?.rooms.length === 2 ? read : undefined;
    });
    expect(onDisk.rooms.map((room) => room.roomCode).sort()).toEqual([roomA, roomB].sort());
  });
});
