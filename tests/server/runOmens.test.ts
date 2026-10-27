import { describe, expect, it } from "vitest";
import { DEFAULT_APPEARANCE } from "../../src/shared/constants/appearance.js";
import { PLAYER_BASE_RESISTANCE, RESISTANCE_DECAY_GRACE_MS, VOICE_SILENCE_DISTANCE } from "../../src/shared/constants/game.js";
import { gameContent } from "../../src/server/content/loadContent.js";
import { recipe } from "../../src/server/game/generation/delve.js";
import type { DelveDungeon } from "../../src/server/content/schema.js";
import { hubStateMessage } from "../../src/server/game/hubState.js";
import { returnToHub, startRun } from "../../src/server/game/runLifecycle.js";
import { advanceVitals, runStateFor } from "../../src/server/game/vitals.js";
import { voiceRangeForPlayer, type VisibilityFrame } from "../../src/server/game/visibility.js";
import { SessionStore } from "../../src/server/sessions/sessionStore.js";
import { at, joinRequest, testPlayer, testSession } from "./fixtures.js";

const content = gameContent();
const profile = content.dungeons.get("vault-run") as DelveDungeon;

/** A store whose next run is a known seed, or a fresh one each time when `seed` is omitted. */
function hub(names: string[], seed?: number) {
  let id = 0;
  const store = new SessionStore({
    dungeon: { dungeonId: "vault-run", ...(seed === undefined ? {} : { seed }) },
    createPlayerId: () => `player-${(id += 1)}`,
    createSessionId: () => `session-${(id += 1)}`,
    createResumeToken: () => `token-${(id += 1)}`,
    createRoomCode: () => "ROOM01",
  });
  const session = store.createSession();
  const join = (playerName: string) => {
    const joined = store.join(joinRequest({ roomCode: session.roomCode, playerName }));
    if (!joined.ok) throw new Error(joined.message);
    store.setAppearance(joined.player.id, DEFAULT_APPEARANCE);
    return joined.player;
  };
  return { store, session, join, players: names.map(join) };
}

const shownOmens = (session: Parameters<typeof hubStateMessage>[0]): string[] =>
  hubStateMessage(session).nextRun.omens.map((omen) => omen.id);

/** Readies everyone, starts the run, and returns the ids of the omens it was built with. */
function startAndRead(session: Parameters<typeof startRun>[0]): string[] {
  for (const player of session.players.values()) player.ready = true;
  expect(startRun(session, 1_000)).toEqual({ ok: true });
  return session.runOmens;
}

/** The first seed at or after `from` whose recipe for `partySize` rolls `omenId`. */
function seedRolling(omenId: string, partySize: number, from = 1): number {
  for (let seed = from; seed < from + 5_000; seed += 1) {
    if (recipe(profile, content, seed, partySize, {}).omens.some((omen) => omen.id === omenId)) return seed;
  }
  throw new Error(`No seed rolls ${omenId}`);
}

describe("the hub board", () => {
  it("shows the omens of the run the party then builds, for the same seed", () => {
    for (const seed of [3, 41, 207, seedRolling("short-fuse", 2), seedRolling("echoing-halls", 2)]) {
      const { session } = hub(["Alpha", "Beta"], seed);
      const shown = shownOmens(session);
      expect(startAndRead(session)).toEqual(shown);
    }
  });

  it("names the flow and biome the run is built from", () => {
    const { session } = hub(["Alpha"], 5);
    const { flow, biome } = recipe(profile, content, 5, 1, {});
    expect(hubStateMessage(session).nextRun).toMatchObject({ flowName: flow.name, biomeName: biome.name });
  });

  it("shows no recipe for an authored run", () => {
    const { session } = hub(["Alpha"]);
    session.runDungeon = { dungeonId: "ember-vault" };
    expect(hubStateMessage(session).nextRun).toEqual({ omens: [] });
  });

  it("follows a join mid-hub: the board is rebuilt for the party that will play", () => {
    const seed = seedRolling("short-fuse", 1);
    const { session, join } = hub(["Alpha"], seed);
    const alone = hubStateMessage(session);
    expect(alone.nextRun.flowName).toBe(recipe(profile, content, seed, 1, {}).flow.name);

    join("Beta");
    join("Gamma");
    expect(hubStateMessage(session).nextRun).toMatchObject({
      flowName: recipe(profile, content, seed, 3, {}).flow.name,
      biomeName: recipe(profile, content, seed, 3, {}).biome.name,
    });
    expect(startAndRead(session)).toEqual(shownOmens(session));
  });

  it("holds through a disconnect during ready-up, and the run still matches once they return", () => {
    const { session, players } = hub(["Alpha", "Beta"], seedRolling("echoing-halls", 2));
    const before = hubStateMessage(session);
    for (const player of players) player.ready = true;

    players[1]!.connected = false;
    expect(hubStateMessage(session)).toEqual(before);
    expect(startRun(session, 1_000)).toEqual({ ok: false, reason: "notPermitted" });

    players[1]!.connected = true;
    expect(startRun(session, 1_000)).toEqual({ ok: true });
    expect(session.runOmens).toEqual(before.nextRun.omens.map((omen) => omen.id));
  });

  it("re-rolls after a run, and the new board matches the next build", () => {
    const { session } = hub(["Alpha", "Beta"]);
    const firstSeed = session.nextRunSeed;
    startAndRead(session);
    expect(session.seed).toBe(firstSeed);

    returnToHub(session, true);
    expect(session.location).toBe("hub");
    expect(session.nextRunSeed).not.toBe(firstSeed);
    const shown = shownOmens(session);
    expect(startAndRead(session)).toEqual(shown);
    expect(session.seed).not.toBe(firstSeed);
  });

  it("keeps a pinned seed across runs, for replays", () => {
    const { session } = hub(["Alpha"], 99);
    startAndRead(session);
    returnToHub(session, true);
    expect(session.nextRunSeed).toBe(99);
  });
});

describe("Short Fuse", () => {
  function runWith(omens: string[]) {
    const player = testPlayer("alpha", { enteredDungeonAt: 0 });
    const session = testSession([player]);
    session.runOmens = omens;
    return { player, session };
  }

  it("starts decay at 6 minutes in a run that has it", () => {
    const { player, session } = runWith(["short-fuse"]);
    advanceVitals(session, 0, 0);
    advanceVitals(session, 360_000 + 1_000, 360_000 + 1_000);
    expect(player.resistance).toBeLessThan(PLAYER_BASE_RESISTANCE);
    expect(runStateFor(player, 359_000, 360_000)).toMatchObject({ decayGraceMs: 360_000, decayStartsInMs: 1_000 });
  });

  it("leaves a run without it at 10 minutes", () => {
    const { player, session } = runWith([]);
    advanceVitals(session, 0, 0);
    advanceVitals(session, 360_000 + 1_000, 360_000 + 1_000);
    expect(player.resistance).toBe(PLAYER_BASE_RESISTANCE);
    expect(runStateFor(player, 0)).toMatchObject({ decayGraceMs: RESISTANCE_DECAY_GRACE_MS });
  });
});

describe("Echoing Halls", () => {
  function volumeAt(gap: number, omens: string[]): number {
    const viewer = testPlayer("viewer", { position: at(2, 2) });
    const peer = testPlayer("peer", { position: at(2, 2) });
    peer.position = { x: viewer.position.x + gap, y: viewer.position.y };
    const session = testSession([viewer, peer]);
    session.runOmens = omens;
    const frame = { visiblePlayerIds: new Set(["peer"]) } as VisibilityFrame;
    return voiceRangeForPlayer(session, viewer, frame).peers[0]!.volume;
  }

  it("carries a voice 1.5 times as far, only in a run that has it", () => {
    const gap = VOICE_SILENCE_DISTANCE + 1;
    expect(volumeAt(gap, [])).toBe(0);
    expect(volumeAt(gap, ["echoing-halls"])).toBeGreaterThan(0);
    expect(volumeAt(VOICE_SILENCE_DISTANCE * 1.5, ["echoing-halls"])).toBe(0);
  });
});
