import { DEFAULT_APPEARANCE } from "../../src/shared/constants/appearance.js";
import {
  PLAYER_BASE_RESISTANCE,
  PLAYER_MAX_STAMINA,
  TILE_SCALE,
} from "../../src/shared/constants/game.js";
import { buildDungeon } from "../../src/server/game/dungeonState.js";
import { lootRngFor } from "../../src/server/game/monsterLoot.js";
import { scalePoint } from "../../src/server/game/scale.js";
import { createRunStats } from "../../src/server/game/milestones.js";
import { RoomSaveStore } from "../../src/server/saves/roomSaveStore.js";
import { createMilestoneStats, type PlayerProfile } from "../../src/server/profiles/profile.js";
import type { JoinRequest, Session, SessionPlayer } from "../../src/server/sessions/sessionStore.js";
import type { Vector2 } from "../../src/shared/types/core.js";

/**
 * The Ember Vault is authored content, not a generated run, so its entity ids and positions are
 * fixed. That is what lets these tests assert on a known world; generated dungeons are covered
 * separately in `generation.test.ts` by seed instead.
 */
export const TEST_DUNGEON_ID = "ember-vault";

/** Pinned Ember Vault entity ids, from `content/dungeons/ember-vault.json`. */
export const ASH_IMP_ID = "11111111-1111-4111-8111-111111111111";
export const CINDER_SLIME_ID = "22222222-2222-4222-8222-222222222222";
export const COPPER_KEY_ID = "33333333-3333-4333-8333-333333333333";
export const MINOR_TONIC_ID = "44444444-4444-4444-8444-444444444444";
/** The wire fields of a Minor Tonic, as `content/items/minor-tonic.json` ships it. */
export const TONIC_FIELDS = {
  kind: "consumable",
  itemId: "minor-tonic",
  description: "Restores 35 health.",
  icon: "tonic",
  useOn: "self",
} as const;

export const WARDING_SALVE_ID = "99999999-9999-4999-8999-999999999999";
export const VAULT_DOOR_ID = "55555555-5555-4555-8555-555555555555";
export const VAULT_EXIT_ID = "66666666-6666-4666-8666-666666666666";

/**
 * The world position of an Ember Vault tile.
 *
 * Content is authored at `1 / TILE_SCALE` of world scale, so the vault's `(2, 2)` spawn is nowhere
 * near world `(2, 2)`. Tests name the tile they mean and let this do the conversion, the same way
 * `scaleDungeon` does for the real thing, so a change of scale does not rewrite every assertion.
 *
 * `dx` and `dy` nudge the result by world units, for the cases that care about a body's width
 * rather than about which tile it stands in.
 */
export function at(x: number, y: number, dx = 0, dy = 0): Vector2 {
  const point = scalePoint({ x, y }, TILE_SCALE);
  return { x: point.x + dx, y: point.y + dy };
}

/**
 * A profile with nothing banked, for the tests that only need a player to have one.
 *
 * `secretHash` is a plausible-looking constant rather than a real hash: nothing here resolves a
 * secret, and `tests/server/profiles.test.ts` covers the cases that do.
 */
export function testProfile(id: string, overrides: Partial<PlayerProfile> = {}): PlayerProfile {
  return {
    id: `profile-${id}`,
    secretHash: "0".repeat(64),
    displayName: id,
    bankedItems: [],
    skillStacks: {},
    coin: 0,
    stats: createMilestoneStats(),
    earnedMilestones: [],
    ownedCosmeticIds: ["leather-cap", "traveler-cape"],
    equippedCosmetics: { hat: null, cloak: null, dye: null, trail: null, flame: null },
    runsEscaped: 0,
    runsLost: 0,
    createdAt: 0,
    lastSeenAt: 0,
    revision: 0,
    ...overrides,
  };
}

let profileCounter = 0;

/**
 * A join request carrying a fresh profile, for the tests that care about sessions rather than
 * progression. Pass `profile` to hand a join one that already exists.
 *
 * Every call mints a distinct profile, including two joins under the same player name, so a test
 * about party size is never accidentally a test about one profile playing twice.
 */
export function joinRequest(
  fields: Pick<JoinRequest, "roomCode" | "playerName"> & Partial<JoinRequest>,
): JoinRequest {
  return {
    profile: null,
    createProfile: () => testProfile(`${fields.playerName}-${(profileCounter += 1)}`),
    ...fields,
  };
}

export function testPlayer(id: string, overrides: Partial<SessionPlayer> = {}): SessionPlayer {
  return {
    id,
    name: id,
    position: at(2, 2),
    facing: { x: 0, y: 1 },
    health: 100,
    resistance: PLAYER_BASE_RESISTANCE,
    stamina: PLAYER_MAX_STAMINA,
    ready: false,
    connected: true,
    inventory: [],
    held: null,
    draw: null,
    runSkillStacks: new Map(),
    runCoin: 0,
    runStats: createRunStats(),
    carryingTorch: true,
    carryingPlayerId: null,
    carriedByPlayerId: null,
    seatId: null,
    readyPlateId: null,
    readyFromPlate: false,
    declinedPlateId: null,
    appearance: { ...DEFAULT_APPEARANCE },
    partyColor: "ember",
    profile: testProfile(id),
    discoveredTiles: new Uint8Array(0),
    discoveredRoomIds: new Set(),
    discoveryLog: [],
    pendingDiscovery: [],
    mapSyncedTo: null,
    resumeToken: id.padEnd(32, "0"),
    disconnectedAt: null,
    nextMoveAt: null,
    nextAttackAt: null,
    enteredDungeonAt: 0,
    lastCombatAt: null,
    ...overrides,
  };
}

/**
 * Pinned so a generated dungeon is the same one every run.
 *
 * Without it `buildDungeon` draws a fresh seed, and a layout that happens to leave no floor tile
 * `SNAPSHOT_VIEW_RADIUS_TILES` clear of every edge failed `scale.test.ts` about one run in twenty.
 * A test about windowing should not also be a test about which map came out of the generator.
 */
export const TEST_SEED = 20260920;

export function testSession(players: SessionPlayer[], dungeonId = TEST_DUNGEON_ID): Session {
  const request = { dungeonId, seed: TEST_SEED };
  const built = buildDungeon(request);

  return {
    id: "session-1",
    roomCode: "ROOM01",
    createdAt: 0,
    dungeon: built.dungeon,
    location: "dungeon",
    runDungeon: request,
    spawnPoints: built.spawnPoints,
    seed: built.seed,
    lootRng: lootRngFor(built.seed, dungeonId),
    tick: 0,
    players: new Map(players.map((member) => [member.id, member])),
    simulatedAt: null,
    monsterCooldowns: new Map(),
    monsterWindups: new Map(),
    monsterPosts: new Map(),
    monsterCharges: new Map(),
    projectileRuns: new Map(),
    trapRearmAt: new Map(),
    puzzleHeldSince: new Map(),
    flareExpiresAt: new Map(),
    campSeatedSince: new Map(),
    campsRested: new Set(),
    dummyHits: new Map(),
    vault: { roomCode: "ROOM01", items: [], runCount: 0, revision: 0 },
    saves: new RoomSaveStore(),
  };
}

export function monster(session: Session, id: string) {
  const found = session.dungeon.monsters.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`No monster ${id}`);
  return found;
}
