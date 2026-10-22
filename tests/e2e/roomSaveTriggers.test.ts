import { existsSync, mkdtempSync, rmSync } from "node:fs";
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

const TICK_MS = 20;
const LOOK = { body: "girl", skinTone: "tan", hairStyle: "bun", hairColor: "silver" } as const;

let server: GameServer;
let saves: RoomSaveStore;
let baseUrl: string;
let wsUrl: string;
let directory: string;
const clients: Client[] = [];

/** A bare socket that buffers what the server sends. */
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
}

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

/** Joins and designs a character, waiting until a snapshot shows the player spawned. */
async function joinRoom(roomCode: string, playerName: string) {
  const client = await Client.connect();
  client.send({ type: "joinSession", protocolVersion: PROTOCOL_VERSION, roomCode, playerName });
  const joined = await client.waitFor("sessionJoined");
  client.send({ type: "setAppearance", appearance: LOOK });
  await client.waitFor("stateSnapshot", (snapshot) =>
    snapshot.players.some((player) => player.id === joined.playerId && player.appearance !== null),
  );
  return { client, joined };
}

/** Readies everyone and walks the first through the hub entrance, so the party is in the dungeon. */
async function enterDungeon(roomCode: string, members: Awaited<ReturnType<typeof joinRoom>>[]) {
  for (const { client } of members) client.send({ type: "setReady", ready: true });
  const session = server.store.getSession(roomCode);
  const entrance = session?.dungeon.exits[0];
  const first = members[0];
  if (!session || !entrance || !first) throw new Error("expected a hub entrance and a player");

  await eventually(() => [...session.players.values()].every((player) => player.ready));
  const player = session.players.get(first.joined.playerId);
  if (player) player.position = { ...entrance.position };
  first.client.send({ type: "playerInteract", targetId: entrance.id });
  await first.client.waitFor("stateSnapshot", (snapshot) => snapshot.location === "dungeon");
  return session;
}

async function startServer(autosaveIntervalMs: number): Promise<void> {
  saves = new RoomSaveStore(createFileRoomSaveStorage(join(directory, "rooms.json")));
  server = createGameServer({
    store: new SessionStore({ saves, dungeon: { dungeonId: "ember-vault" } }),
    tickIntervalMs: TICK_MS,
    sweepIntervalMs: 10_000,
    autosaveIntervalMs,
    log: false,
  });
  const address = await server.listen(0, "127.0.0.1");
  baseUrl = `http://127.0.0.1:${address.port}`;
  wsUrl = `ws://127.0.0.1:${address.port}`;
}

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "dnd-save-triggers-"));
  await startServer(30);
});

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  await server.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("room saves written by the server", () => {
  it("adds a player to the room's members when they set their look, with no run in the hub", async () => {
    const roomCode = await createRoom();
    await joinRoom(roomCode, "Alpha");

    const save = await eventually(() => saves.get(roomCode));
    expect(save.members.map((member) => member.name)).toEqual(["Alpha"]);
    expect(save.members[0]?.appearance).toEqual(LOOK);
    expect(save.run).toBeNull();
  });

  it("autosaves a run on the interval", async () => {
    const roomCode = await createRoom();
    const alpha = await joinRoom(roomCode, "Alpha");
    await enterDungeon(roomCode, [alpha]);

    const run = await eventually(() => saves.get(roomCode)?.run);
    expect(run.players).toHaveLength(1);
  });

  it("saves when the last connected member disconnects, without waiting for an autosave", async () => {
    await server.close();
    await startServer(60_000);
    const roomCode = await createRoom();
    const alpha = await joinRoom(roomCode, "Alpha");
    const session = await enterDungeon(roomCode, [alpha]);
    const player = session.players.get(alpha.joined.playerId);
    if (!player) throw new Error("expected the player");
    expect(saves.get(roomCode)?.run).toBeNull();

    const position = { x: player.position.x + 1, y: player.position.y };
    player.position = position;
    alpha.client.close();

    const run = await eventually(() => saves.get(roomCode)?.run);
    expect(run.players[0]?.position).toEqual(position);
  });

  it("drops a player's run entry when they leave on purpose", async () => {
    const roomCode = await createRoom();
    const alpha = await joinRoom(roomCode, "Alpha");
    const beta = await joinRoom(roomCode, "Beta");
    await enterDungeon(roomCode, [alpha, beta]);
    await eventually(() => saves.get(roomCode)?.run?.players.length === 2);

    beta.client.send({ type: "leaveSession" });

    await eventually(() => saves.get(roomCode)?.run?.players.length === 1);
    const save = saves.get(roomCode)!;
    expect(save.members).toHaveLength(2);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(saves.get(roomCode)?.run?.players).toHaveLength(1);
  });

  it("leaves a valid file with no temporary copy behind when a player disconnects during autosaves", async () => {
    const roomCode = await createRoom();
    const alpha = await joinRoom(roomCode, "Alpha");
    await enterDungeon(roomCode, [alpha]);
    await eventually(() => saves.get(roomCode)?.run);
    await new Promise((resolve) => setTimeout(resolve, 100));

    alpha.client.close();
    await eventually(() => [...(server.store.getSession(roomCode)?.players.values() ?? [])].every((p) => !p.connected));

    const path = join(directory, "rooms.json");
    const read = createFileRoomSaveStorage(path).read();
    expect(read?.rooms.find((room) => room.roomCode === roomCode)?.run).not.toBeNull();
    expect(existsSync(`${path}.tmp`)).toBe(false);
  });
});

describe("saveAndQuit over the socket", () => {
  it("removes the player, keeps them in the save, and leaves the rest of the party playing", async () => {
    const roomCode = await createRoom();
    const alpha = await joinRoom(roomCode, "Alpha");
    const beta = await joinRoom(roomCode, "Beta");
    const session = await enterDungeon(roomCode, [alpha, beta]);
    const quitter = session.players.get(beta.joined.playerId);
    if (!quitter) throw new Error("expected the player");
    quitter.position = { x: quitter.position.x + 2, y: quitter.position.y };
    const position = { ...quitter.position };

    beta.client.send({ type: "saveAndQuit" });

    expect((await beta.client.waitFor("savedAndQuit")).roomCode).toBe(roomCode);
    const left = await alpha.client.waitFor("playerLeft");
    expect(left.playerId).toBe(beta.joined.playerId);
    expect(session.players.has(beta.joined.playerId)).toBe(false);
    expect(session.players.has(alpha.joined.playerId)).toBe(true);
    expect(session.location).toBe("dungeon");

    const run = saves.get(roomCode)?.run;
    expect(run?.players).toHaveLength(2);
    const entry = run?.players.find(
      (candidate) => candidate.profileId === quitter.profile.id,
    );
    expect(entry?.position).toEqual(position);
  });

  it("answers inCombat and changes nothing while the player is in a fight", async () => {
    const roomCode = await createRoom();
    const alpha = await joinRoom(roomCode, "Alpha");
    const session = await enterDungeon(roomCode, [alpha]);
    const player = session.players.get(alpha.joined.playerId);
    if (!player) throw new Error("expected the player");
    player.lastCombatAt = performance.now();

    alpha.client.send({ type: "saveAndQuit" });

    const rejected = await alpha.client.waitFor("actionRejected");
    expect(rejected.reason).toBe("inCombat");
    expect(session.players.has(alpha.joined.playerId)).toBe(true);
  });

  it("answers notPermitted in the hub", async () => {
    const roomCode = await createRoom();
    const alpha = await joinRoom(roomCode, "Alpha");

    alpha.client.send({ type: "saveAndQuit" });

    expect((await alpha.client.waitFor("actionRejected")).reason).toBe("notPermitted");
    expect(server.store.getSession(roomCode)?.players.size).toBe(1);
  });

  it("answers notPermitted to a downed player", async () => {
    const roomCode = await createRoom();
    const alpha = await joinRoom(roomCode, "Alpha");
    const beta = await joinRoom(roomCode, "Beta");
    const session = await enterDungeon(roomCode, [alpha, beta]);
    const downed = session.players.get(beta.joined.playerId);
    if (!downed) throw new Error("expected the player");
    downed.health = 0;

    beta.client.send({ type: "saveAndQuit" });

    expect((await beta.client.waitFor("actionRejected")).reason).toBe("notPermitted");
    expect(session.players.has(beta.joined.playerId)).toBe(true);
  });

  it("refuses a malformed message and one sent before joining", async () => {
    const roomCode = await createRoom();
    const alpha = await joinRoom(roomCode, "Alpha");
    const session = await enterDungeon(roomCode, [alpha]);

    alpha.client.send({ type: "saveAndQuit", keepEverything: true });
    expect((await alpha.client.waitFor("sessionError")).code).toBe("invalidMessage");
    expect(session.players.has(alpha.joined.playerId)).toBe(true);

    const stranger = await Client.connect();
    stranger.send({ type: "saveAndQuit" });
    expect((await stranger.waitFor("sessionError")).code).toBe("notInSession");
  });
});
