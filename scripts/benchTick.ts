import { deflateSync } from "node:zlib";
import { simulate } from "../src/server/game/combat.js";
import { walkableGridFor } from "../src/server/game/flowField.js";
import { hasLineOfSight, takeMapDiscovery, visibilityFrameForPlayer } from "../src/server/game/visibility.js";
import { startRun } from "../src/server/game/runLifecycle.js";
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

// Worst case for monster pathing: each player stands where a monster has no line of sight to them
// but they are still inside its aggro range, after the monster has noticed them. Every hunting
// monster then steers by the shared distance field rather than a straight line.
function huntMonstersFromBehindWalls(): () => void {
  const grid = walkableGridFor(dungeon);
  const saved = players.map((player) => ({ ...player.position }));
  const hunters = dungeon.monsters.filter((monster) => monster.alive).slice(0, players.length);

  hunters.forEach((hunter, index) => {
    const player = players[index]!;
    player.position = { ...hunter.position };
    simulate(session, (clock += TICK_BUDGET_MS));

    for (let radius = 7; radius <= 14 && player.position.x === hunter.position.x; radius += 1) {
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          const x = Math.round(hunter.position.x) + dx;
          const y = Math.round(hunter.position.y) + dy;
          if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) continue;
          if (grid.tiles[y * grid.width + x] !== 1 || Math.hypot(dx, dy) > radius) continue;
          if (hasLineOfSight(dungeon, hunter.position, { x, y })) continue;
          player.position = { x, y };
          dx = radius + 1;
          dy = radius + 1;
        }
      }
    }
  });

  return () => players.forEach((player, index) => (player.position = saved[index]!));
}

const restorePlayers = huntMonstersFromBehindWalls();
report(
  "simulate (monsters hunting)",
  measure(200, () => {
    clock += TICK_BUDGET_MS;
    simulate(session, clock);
  }),
);
restorePlayers();

const visibilityPass = () => {
  for (const player of players) visibilityFrameForPlayer(session, player);
};
report("visibility, 4 players (spawn)", measure(100, visibilityPass));

const snapshotFor = (tick: number) => {
  const frame = visibilityFrameForPlayer(session, players[0]!);
  return {
    type: "stateSnapshot" as const,
    tick,
    location: session.location,
    players: frame.players,
    dungeon: { ...frame.dungeon, map: takeMapDiscovery(session, players[0]!) },
    run: runStateFor(players[0]!, clock),
  };
};
const describeSnapshot = (label: string, snapshot: ReturnType<typeof snapshotFor>) => {
  const raw = serializeServerMessage(snapshot);
  console.log(`${label.padEnd(34)} ${raw.length} bytes, ${deflateSync(raw).length} deflated`);
};

// The first snapshot a client gets carries the baseline; every later one only what is new.
describeSnapshot("snapshot (baseline at spawn)", snapshotFor(1));
const steady = snapshotFor(2);
describeSnapshot("snapshot (steady state)", steady);
report(
  "serialize steady snapshot x4",
  measure(100, () => {
    for (let index = 0; index < PARTY_SIZE; index += 1) serializeServerMessage(steady);
  }),
);
report(
  "snapshot build x4 (steady)",
  measure(100, () => {
    for (const player of players) {
      const frame = visibilityFrameForPlayer(session, player);
      takeMapDiscovery(session, player);
      void frame;
    }
  }),
);

for (const player of players) {
  player.discoveredTiles.fill(1);
  player.mapSyncedTo = null;
}
describeSnapshot("snapshot (baseline, all explored)", snapshotFor(3));
report("visibility, 4 players (explored)", measure(50, visibilityPass));
describeSnapshot("snapshot (steady, all explored)", snapshotFor(4));
