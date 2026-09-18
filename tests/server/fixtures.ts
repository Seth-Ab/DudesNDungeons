import {
  PLAYER_BASE_RESISTANCE,
  PLAYER_MAX_STAMINA,
  TILE_SCALE,
} from "../../src/shared/constants/game.js";
import { buildDungeon } from "../../src/server/game/dungeonState.js";
import { scalePoint } from "../../src/server/game/scale.js";
import type { Session, SessionPlayer } from "../../src/server/sessions/sessionStore.js";
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
    carryingTorch: true,
    bankedItems: [],
    discoveredTiles: new Set(),
    discoveredRoomIds: new Set(),
    resumeToken: id.padEnd(32, "0"),
    disconnectedAt: null,
    nextMoveAt: null,
    nextAttackAt: null,
    enteredDungeonAt: 0,
    ...overrides,
  };
}

export function testSession(players: SessionPlayer[], dungeonId = TEST_DUNGEON_ID): Session {
  const built = buildDungeon({ dungeonId });

  return {
    id: "session-1",
    roomCode: "ROOM01",
    createdAt: 0,
    dungeon: built.dungeon,
    location: "dungeon",
    runDungeon: { dungeonId },
    spawnPoints: built.spawnPoints,
    seed: built.seed,
    tick: 0,
    players: new Map(players.map((member) => [member.id, member])),
    simulatedAt: null,
    monsterCooldowns: new Map(),
  };
}

export function monster(session: Session, id: string) {
  const found = session.dungeon.monsters.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`No monster ${id}`);
  return found;
}
