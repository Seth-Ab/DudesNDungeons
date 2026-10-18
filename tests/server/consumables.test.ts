import { describe, expect, it } from "vitest";
import { itemDefinitionSchema } from "../../src/server/content/schema.js";
import { simulate } from "../../src/server/game/combat.js";
import { movePlayer } from "../../src/server/game/dungeonState.js";
import { useItem } from "../../src/server/game/items.js";
import { partyWiped } from "../../src/server/game/runLifecycle.js";
import { takeMapDiscovery, visibilityFrameForPlayer } from "../../src/server/game/visibility.js";
import { INTERACT_RANGE, PLAYER_MAX_STAMINA } from "../../src/shared/constants/game.js";
import { clientMessageSchema } from "../../src/shared/protocol/index.js";
import type { InventoryItem } from "../../src/shared/types/core.js";
import { at, testPlayer, testSession } from "./fixtures.js";

const DRAUGHT_ID = "d1111111-1111-4111-8111-111111111111";
const FLARE_ID = "f1111111-1111-4111-8111-111111111111";
const SALTS_ID = "e1111111-1111-4111-8111-111111111111";
const TONIC_ID = "a1111111-1111-4111-8111-111111111111";
const ALPHA_ID = "a0000000-0000-4000-8000-000000000001";
const BETA_ID = "b0000000-0000-4000-8000-000000000002";
const GAMMA_ID = "c0000000-0000-4000-8000-000000000003";

/** The wire fields `content/items/` ships for each item, as a pickup would carry them. */
function draught(): InventoryItem {
  return {
    id: DRAUGHT_ID,
    name: "Stamina Draught",
    kind: "consumable",
    itemId: "stamina-draught",
    description: "Restores 50 stamina.",
    icon: "draught",
    useOn: "self",
  };
}

function flare(): InventoryItem {
  return {
    id: FLARE_ID,
    name: "Flare",
    kind: "consumable",
    itemId: "flare",
    description: "Lights the ground at your feet for 30 seconds.",
    icon: "flare",
    useOn: "self",
  };
}

function salts(): InventoryItem {
  return {
    id: SALTS_ID,
    name: "Smelling Salts",
    kind: "consumable",
    itemId: "smelling-salts",
    description: "Revives a downed ally in reach with 35 health.",
    icon: "salts",
    useOn: "downedAlly",
  };
}

/** Flare content: `radius` 9 and `durationMs` 30000 in `content/items/flare.json`. */
const FLARE_DURATION_MS = 30_000;

describe("stamina draught", () => {
  it("is refused at full stamina and kept", () => {
    const player = testPlayer(ALPHA_ID, { stamina: PLAYER_MAX_STAMINA, inventory: [draught()] });
    const session = testSession([player]);

    expect(useItem(session, ALPHA_ID, DRAUGHT_ID)).toEqual({ ok: false, reason: "notPermitted" });
    expect(player.inventory).toHaveLength(1);
  });

  it("restores stamina, capped, and is used up", () => {
    const player = testPlayer(ALPHA_ID, { stamina: 70, inventory: [draught()] });
    const session = testSession([player]);

    expect(useItem(session, ALPHA_ID, DRAUGHT_ID)).toEqual({ ok: true });
    expect(player.stamina).toBe(PLAYER_MAX_STAMINA);
    expect(player.inventory).toEqual([]);
  });
});

describe("flare", () => {
  /** Two torchless players in the vault's west approach, with every other light put out. */
  function darkVault() {
    const alpha = testPlayer(ALPHA_ID, { position: at(2, 5), carryingTorch: false, inventory: [flare()] });
    const beta = testPlayer(BETA_ID, { position: at(3, 5), carryingTorch: false });
    const session = testSession([alpha, beta]);
    session.dungeon.lightSources = [];
    session.dungeon.monsters = [];
    return { session, alpha, beta };
  }

  it("lights the dark for both players until durationMs passes, then goes out", () => {
    const { session, alpha, beta } = darkVault();
    simulate(session, 0);

    for (const viewer of [alpha, beta]) {
      const frame = visibilityFrameForPlayer(session, viewer);
      expect(frame.dungeon.lightSources).toEqual([]);
      expect(takeMapDiscovery(session, viewer).lit).toEqual([]);
    }

    expect(useItem(session, ALPHA_ID, FLARE_ID, 1000)).toEqual({ ok: true });
    expect(alpha.inventory).toEqual([]);

    simulate(session, 1000 + FLARE_DURATION_MS - 1);
    for (const viewer of [alpha, beta]) {
      const frame = visibilityFrameForPlayer(session, viewer);
      expect(frame.dungeon.lightSources).toMatchObject([
        { kind: "flare", position: alpha.position, radius: 9 },
      ]);
      expect(takeMapDiscovery(session, viewer).lit.length).toBeGreaterThan(0);
      // Each player stands in the flare's light, so each sees the other.
      expect(frame.visiblePlayerIds.has(viewer === alpha ? BETA_ID : ALPHA_ID)).toBe(true);
    }

    simulate(session, 1000 + FLARE_DURATION_MS);
    expect(session.dungeon.lightSources).toEqual([]);
    expect(session.flareExpiresAt.size).toBe(0);
    for (const viewer of [alpha, beta]) {
      const frame = visibilityFrameForPlayer(session, viewer);
      expect(frame.dungeon.lightSources).toEqual([]);
      expect(takeMapDiscovery(session, viewer).lit).toEqual([]);
    }
  });

  it("stays where it was put down when its owner walks away", () => {
    const { session, alpha } = darkVault();
    useItem(session, ALPHA_ID, FLARE_ID, 0);
    const placed = { ...alpha.position };

    alpha.position = at(5, 1);
    expect(session.dungeon.lightSources[0]?.position).toEqual(placed);
  });
});

describe("smelling salts", () => {
  function party(overrides: { reviver?: Parameters<typeof testPlayer>[1]; downed?: Parameters<typeof testPlayer>[1] } = {}) {
    const reviver = testPlayer(ALPHA_ID, { position: at(2, 5), inventory: [salts()], ...overrides.reviver });
    const downed = testPlayer(BETA_ID, { position: at(2, 5, 0.8), health: 0, ...overrides.downed });
    const session = testSession([reviver, downed]);
    return { session, reviver, downed };
  }

  it("revives a downed ally in reach, spends the salts, and costs the user stamina", () => {
    const { session, reviver, downed } = party();

    expect(useItem(session, ALPHA_ID, SALTS_ID, 0, BETA_ID)).toEqual({ ok: true });
    expect(downed.health).toBe(35);
    expect(reviver.inventory).toEqual([]);
    expect(reviver.stamina).toBe(PLAYER_MAX_STAMINA - 30);
  });

  it("is refused out of reach", () => {
    const { session, reviver, downed } = party({ downed: { position: at(2, 5, INTERACT_RANGE + 0.5) } });

    expect(useItem(session, ALPHA_ID, SALTS_ID, 0, BETA_ID)).toEqual({ ok: false, reason: "outOfRange" });
    expect(downed.health).toBe(0);
    expect(reviver.inventory).toHaveLength(1);
  });

  it("is refused on a standing target", () => {
    const { session, reviver } = party({ downed: { health: 60 } });

    expect(useItem(session, ALPHA_ID, SALTS_ID, 0, BETA_ID)).toEqual({ ok: false, reason: "notPermitted" });
    expect(reviver.inventory).toHaveLength(1);
  });

  it("is refused to a downed user", () => {
    const { session, downed } = party({ reviver: { health: 0 } });

    expect(useItem(session, ALPHA_ID, SALTS_ID, 0, BETA_ID)).toEqual({ ok: false, reason: "notPermitted" });
    expect(downed.health).toBe(0);
  });

  it("is refused while the target is carried or disconnected", () => {
    const carrier = testPlayer(GAMMA_ID, { position: at(2, 5, 0.8), carryingPlayerId: BETA_ID });
    const { session, downed } = party({ downed: { carriedByPlayerId: GAMMA_ID } });
    session.players.set(GAMMA_ID, carrier);

    expect(useItem(session, ALPHA_ID, SALTS_ID, 0, BETA_ID)).toEqual({ ok: false, reason: "notPermitted" });

    downed.carriedByPlayerId = null;
    downed.connected = false;
    expect(useItem(session, ALPHA_ID, SALTS_ID, 0, BETA_ID)).toEqual({ ok: false, reason: "notPermitted" });
    expect(downed.health).toBe(0);
  });

  it("is refused, keeping the salts, when the user cannot afford the stamina", () => {
    const { session, reviver, downed } = party({ reviver: { stamina: 29 } });

    expect(useItem(session, ALPHA_ID, SALTS_ID, 0, BETA_ID)).toEqual({ ok: false, reason: "exhausted" });
    expect(downed.health).toBe(0);
    expect(reviver.stamina).toBe(29);
    expect(reviver.inventory).toHaveLength(1);
  });

  it("needs a target, refuses the user as one, and refuses a target on a self-use item", () => {
    const { session, reviver } = party();
    reviver.inventory.push(draught());
    reviver.stamina = 50;

    expect(useItem(session, ALPHA_ID, SALTS_ID, 0)).toEqual({ ok: false, reason: "targetMissing" });
    expect(useItem(session, ALPHA_ID, SALTS_ID, 0, ALPHA_ID)).toEqual({ ok: false, reason: "notPermitted" });
    expect(useItem(session, ALPHA_ID, SALTS_ID, 0, GAMMA_ID)).toEqual({ ok: false, reason: "targetMissing" });
    expect(useItem(session, ALPHA_ID, DRAUGHT_ID, 0, BETA_ID)).toEqual({ ok: false, reason: "notPermitted" });
    expect(reviver.inventory).toHaveLength(2);
    expect(reviver.stamina).toBe(50);
  });

  it("lets the revived player act again, so the party is no longer one blow from a wipe", () => {
    const { session, reviver, downed } = party();
    expect(movePlayer(session, BETA_ID, { x: 0, y: -1 }, 0)).toEqual({ ok: false, reason: "notPermitted" });

    expect(useItem(session, ALPHA_ID, SALTS_ID, 0, BETA_ID).ok).toBe(true);
    expect(movePlayer(session, BETA_ID, { x: 0, y: -1 }, 0).ok).toBe(true);

    // The reviver goes down next. Before the revive this would have wiped the party.
    reviver.health = 0;
    expect(partyWiped(session)).toBe(false);
    downed.health = 0;
    expect(partyWiped(session)).toBe(true);
  });
});

describe("consumable content and protocol", () => {
  it("rejects a revive mixed with other effects", () => {
    const parsed = itemDefinitionSchema.safeParse({
      id: "odd-salts",
      name: "Odd Salts",
      kind: "consumable",
      description: "Does too much.",
      effects: [
        { type: "revive", healthFraction: 0.5, staminaCost: 10 },
        { type: "heal", amount: 10 },
      ],
    });
    expect(parsed.success).toBe(false);
  });

  it("accepts useItem with or without a target, and rejects a malformed one", () => {
    expect(clientMessageSchema.safeParse({ type: "useItem", itemId: SALTS_ID, targetPlayerId: BETA_ID }).success).toBe(true);
    expect(clientMessageSchema.safeParse({ type: "useItem", itemId: TONIC_ID }).success).toBe(true);
    expect(clientMessageSchema.safeParse({ type: "useItem", itemId: SALTS_ID, targetPlayerId: "beta" }).success).toBe(false);
  });
});
