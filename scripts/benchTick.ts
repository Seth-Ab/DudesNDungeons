import { deflateSync } from "node:zlib";
import { simulate } from "../src/server/game/combat.js";
import { startRun } from "../src/server/game/runLifecycle.js";
import { visibilityFrameForPlayer } from "../src/server/game/visibility.js";
import { runStateFor } from "../src/server/game/vitals.js";
import { ProfileStore } from "../src/server/profiles/profileStore.js";
import { SessionStore, type Session } from "../src/server/sessions/sessionStore.js";
import { serializeServerMessage } from "../src/shared/protocol/index.js";

/**
 * Times the parts of one 20 Hz server tick against a fixed generated dungeon, so a change that
 * claims to make the tick cheaper has a number to point at. Run with `npm run bench:tick`.
 *
 * Reports the mean and 95th percentile of each step for a four-player party, each carrying a torch.
 * Visibility is measured twice: freshly spawned, and after every tile of the world has been
 * discovered, because the cost of remembering the map is the part that grows over a run.
 */

const SEED = 1234;
const PARTY_SIZE = 4;
const TICK_BUDGET_MS = 50;

function buildParty(): Session {
  const profiles = new ProfileStore();
  const store = new SessionStore({ dungeon: { seed: SEED } });
  const session = store.createSession();

  for (let index = 0; index < PARTY_SIZE; index += 1) {
    const name = `Bench${index + 1}`;
    const joined = store.join({
      roomCode: session.roomCode,
      playerName: name,
      profile: null,
      createProfile: () => profiles.create(name).profile,
    });
    if (!joined.ok) throw new Error(joined.message);
    joined.player.ready = true;
  }

  const started = startRun(session, 0);
  if (!started.ok) throw new Error("The benchmark party could not start a run");
  for (const player of session.players.values()) player.carryingTorch = true;
  return session;
}

function measure(iterations: number, step: () => void): { mean: number; p95: number } {
  const samples: number[] = [];
  for (let index = 0; index < iterations; index += 1) {
    const startedAt = performance.now();
    step();
    samples.push(performance.now() - startedAt);
  }

  samples.sort((a, b) => a - b);
  const mean = samples.reduce((total, sample) => total + sample, 0) / samples.length;
  return { mean, p95: samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))] ?? 0 };
}

function report(label: string, result: { mean: number; p95: number }): void {
  const share = ((result.mean / TICK_BUDGET_MS) * 100).toFixed(1);
  console.log(
    `${label.padEnd(34)} mean ${result.mean.toFixed(3).padStart(8)} ms   ` +
      `p95 ${result.p95.toFixed(3).padStart(8)} ms   (${share}% of the ${TICK_BUDGET_MS} ms tick)`,
  );
}

const session = buildParty();
const players = [...session.players.values()];
const { dungeon } = session;
console.log(
  `seed ${SEED}: ${dungeon.map.width}x${dungeon.map.height} tiles, ${dungeon.monsters.length} monsters, ` +
    `${dungeon.lightSources.length} fixed lights, ${players.length} players`,
);

let clock = 0;
report(
  "simulate",
  measure(200, () => {
    clock += TICK_BUDGET_MS;
    simulate(session, clock);
  }),
);

const visibilityPass = () => {
  for (const player of players) visibilityFrameForPlayer(session, player);
};
report("visibility, 4 players (spawn)", measure(100, visibilityPass));

const frame = visibilityFrameForPlayer(session, players[0]!);
const snapshot = {
  type: "stateSnapshot" as const,
  tick: 1,
  location: session.location,
  players: frame.players,
  dungeon: frame.dungeon,
  run: runStateFor(players[0]!, clock),
};
report(
  "serialize snapshot x4",
  measure(100, () => {
    for (let index = 0; index < PARTY_SIZE; index += 1) serializeServerMessage(snapshot);
  }),
);
const raw = serializeServerMessage(snapshot);
console.log(`snapshot: ${raw.length} bytes, ${deflateSync(raw).length} deflated`);

for (const player of players) {
  player.discoveredTiles.fill(1);
}
report("visibility, 4 players (explored)", measure(50, visibilityPass));
