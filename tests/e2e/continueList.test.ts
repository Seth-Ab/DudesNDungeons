import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { PROTOCOL_VERSION } from "../../src/shared/constants/game.js";
import { createGameServer, type GameServer } from "../../src/server/gameServer.js";
import { createFileProfileStorage } from "../../src/server/profiles/fileProfileStorage.js";
import { ProfileStore } from "../../src/server/profiles/profileStore.js";
import { createFileRoomSaveStorage } from "../../src/server/saves/fileRoomSaveStorage.js";
import { RoomSaveStore } from "../../src/server/saves/roomSaveStore.js";
import { SessionStore } from "../../src/server/sessions/sessionStore.js";
import type { ServerMessage } from "../../src/shared/protocol/index.js";

/**
 * The Continue list across a real restart: two clients play a run, the server shuts down and a new
 * one starts over the same files, and each client finds its own saved character on its own card.
 */

const TICK_MS = 20;
const ALPHA_LOOK = { body: "girl", skinTone: "tan", hairStyle: "bun", hairColor: "silver" } as const;
const BETA_LOOK = { body: "guy", skinTone: "deep", hairStyle: "spiky", hairColor: "azure" } as const;

let server: GameServer;
let baseUrl: string;
let wsUrl: string;
let directory: string;
const sockets: Client[] = [];

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
    sockets.push(client);
    return client;
  }

  send(message: unknown): void {
    this.#ws.send(JSON.stringify(message));
  }

  close(): void {
    this.#ws.close();
  }

  waitFor<T extends ServerMessage["type"]>(
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

async function eventually<T>(read: () => T | undefined | null | false, timeoutMs = 3000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error("timed out waiting for the server");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function startServer(): Promise<void> {
  server = createGameServer({
    store: new SessionStore({
      saves: new RoomSaveStore(createFileRoomSaveStorage(join(directory, "rooms.json"))),
      dungeon: { dungeonId: "ember-vault" },
    }),
    profiles: new ProfileStore({ storage: createFileProfileStorage(join(directory, "profiles.json")) }),
    tickIntervalMs: TICK_MS,
    sweepIntervalMs: 10_000,
    autosaveIntervalMs: 60_000,
    log: false,
  });
  const address = await server.listen(0, "127.0.0.1");
  baseUrl = `http://127.0.0.1:${address.port}`;
  wsUrl = `ws://127.0.0.1:${address.port}`;
}

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "dnd-continue-list-"));
  await startServer();
});

afterEach(async () => {
  for (const client of sockets.splice(0)) client.close();
  await server.close();
  rmSync(directory, { recursive: true, force: true });
});

/** Joins, designs a look, and returns the profile secret the server minted. */
async function joinAndDesign(roomCode: string, playerName: string, look: typeof ALPHA_LOOK | typeof BETA_LOOK) {
  const client = await Client.connect();
  client.send({ type: "joinSession", protocolVersion: PROTOCOL_VERSION, roomCode, playerName });
  const joined = await client.waitFor("sessionJoined");
  client.send({ type: "setAppearance", appearance: look });
  await client.waitFor("stateSnapshot", (snapshot) =>
    snapshot.players.some((player) => player.id === joined.playerId && player.appearance !== null),
  );
  if (joined.profileSecret === null) throw new Error("expected the server to mint a profile secret");
  return { client, joined, secret: joined.profileSecret };
}

describe("the Continue list across a server restart", () => {
  it("gives each member their own character and teammates, and continues without a design screen", async () => {
    const createRoom = async (): Promise<string> =>
      ((await (await fetch(`${baseUrl}/sessions`, { method: "POST" })).json()) as { roomCode: string }).roomCode;
    const roomCode = await createRoom();
    const alpha = await joinAndDesign(roomCode, "Alpha", ALPHA_LOOK);
    const beta = await joinAndDesign(roomCode, "Beta", BETA_LOOK);
    const stranger = await joinAndDesign(await createRoom(), "Stranger", ALPHA_LOOK);

    for (const { client } of [alpha, beta]) client.send({ type: "setReady", ready: true });
    const session = server.store.getSession(roomCode);
    const entrance = session?.dungeon.exits[0];
    if (!session || !entrance) throw new Error("expected a hub entrance");
    await eventually(() => [...session.players.values()].every((player) => player.ready));
    const walker = session.players.get(alpha.joined.playerId);
    if (walker) walker.position = { ...entrance.position };
    alpha.client.send({ type: "playerInteract", targetId: entrance.id });
    await alpha.client.waitFor("stateSnapshot", (snapshot) => snapshot.location === "dungeon");

    for (const client of sockets.splice(0)) client.close();
    await server.close();
    await startServer();

    const asAlpha = await Client.connect();
    asAlpha.send({ type: "listSavedRuns", profileSecret: alpha.secret });
    const alphaCards = (await asAlpha.waitFor("savedRuns")).runs;
    expect(alphaCards).toHaveLength(1);
    expect(alphaCards[0]).toMatchObject({
      roomCode,
      dungeonName: "Ember Vault",
      character: { name: "Alpha", appearance: ALPHA_LOOK },
      teammates: [{ name: "Beta", appearance: BETA_LOOK }],
    });

    const asBeta = await Client.connect();
    asBeta.send({ type: "listSavedRuns", profileSecret: beta.secret });
    const [betaCard] = (await asBeta.waitFor("savedRuns")).runs;
    expect(betaCard?.character).toMatchObject({ name: "Beta", appearance: BETA_LOOK });
    expect(betaCard?.character.partyColor).not.toBe(alphaCards[0]?.character.partyColor);

    // A profile that was not in this run sees nothing, and so does a secret the server never issued.
    const asStranger = await Client.connect();
    asStranger.send({ type: "listSavedRuns", profileSecret: stranger.secret });
    expect((await asStranger.waitFor("savedRuns")).runs).toEqual([]);
    const asUnknown = await Client.connect();
    asUnknown.send({ type: "listSavedRuns", profileSecret: "f".repeat(32) });
    expect((await asUnknown.waitFor("savedRuns")).runs).toEqual([]);

    // Continuing from the card restores the look and colour with no designer.
    asAlpha.send({
      type: "joinSession",
      protocolVersion: PROTOCOL_VERSION,
      roomCode,
      playerName: "Alpha",
      profileSecret: alpha.secret,
      savedRun: "continue",
    });
    const rejoined = await asAlpha.waitFor("sessionJoined");
    expect(rejoined.needsAppearance).toBe(false);
    const snapshot = await asAlpha.waitFor("stateSnapshot", (message) => message.location === "dungeon");
    const self = snapshot.players.find((player) => player.id === rejoined.playerId);
    expect(self?.appearance).toEqual(ALPHA_LOOK);
    expect(self?.partyColor).toBe(alphaCards[0]?.character.partyColor);

    // Once joined, the list is not for this connection to ask for.
    asAlpha.send({ type: "listSavedRuns", profileSecret: alpha.secret });
    expect((await asAlpha.waitFor("sessionError")).code).toBe("alreadyInSession");
  });
});
