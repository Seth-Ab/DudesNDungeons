import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { gameContent, loadContent, type GameContent } from "../../src/server/content/loadContent.js";
import type { LootTableDefinition } from "../../src/server/content/schema.js";
import { chestInstance } from "../../src/server/game/dungeonBuilder.js";
import { buildDungeon } from "../../src/server/game/dungeonState.js";
import { interact } from "../../src/server/game/items.js";
import { lootRngFor } from "../../src/server/game/monsterLoot.js";
import { visibilityFrameForPlayer } from "../../src/server/game/visibility.js";
import type { Session } from "../../src/server/sessions/sessionStore.js";
import { distance, isFloor } from "../../src/shared/game/movement.js";
import type { ChestState } from "../../src/shared/types/core.js";
import { TEST_SEED, at, testPlayer, testSession } from "./fixtures.js";

const CHEST_ID = "c0000000-0000-4000-8000-000000000000";
const KEY = { id: "c1111111-1111-4111-8111-111111111111", name: "Copper Key", kind: "key" as const, itemId: "copper-key" };

/** A guaranteed pair of tonics, so a test can count exactly what one opening spills. */
const TWO_TONICS: LootTableDefinition = {
  id: "two-tonics",
  rolls: 2,
  entries: [{ itemId: "minor-tonic", weight: 1 }],
  nothingWeight: 0,
};

function contentWithTable(table: LootTableDefinition): GameContent {
  const base = gameContent();
  return { ...base, lootTables: new Map([...base.lootTables, [table.id, table]]) };
}

/** The Ember Vault with one chest on open floor at authored tile (4, 4) and alpha standing beside it. */
function vaultWithChest(locked = false): { session: Session; chest: ChestState } {
  const content = contentWithTable(TWO_TONICS);
  const request = { dungeonId: "ember-vault", seed: TEST_SEED, content };
  const built = buildDungeon(request);
  const session = testSession([testPlayer("alpha", { position: at(4, 4, -0.9) })]);
  session.dungeon = built.dungeon;
  session.runDungeon = request;
  session.lootRng = lootRngFor(built.seed, "ember-vault");

  const chest = chestInstance(TWO_TONICS.id, at(4, 4), CHEST_ID, locked);
  session.dungeon.chests.push(chest);
  return { session, chest };
}

describe("opening a chest", () => {
  it("rolls its table once, spills the result beside it, and stays opened", () => {
    const { session, chest } = vaultWithChest();
    const before = session.dungeon.loot.length;

    expect(interact(session, "alpha", CHEST_ID)).toEqual({ ok: true });

    const spilled = session.dungeon.loot.slice(before);
    expect(chest.opened).toBe(true);
    expect(spilled.map((loot) => loot.name)).toEqual(["Minor Tonic", "Minor Tonic"]);
    for (const loot of spilled) {
      expect(loot.pickedUp).toBe(false);
      expect(isFloor(session.dungeon, loot.position)).toBe(true);
      // Beside the chest rather than hidden under it.
      expect(distance(loot.position, chest.position)).toBeGreaterThanOrEqual(1.5);
    }
  });

  it("refuses a second interact and spills nothing more", () => {
    const { session, chest } = vaultWithChest();
    interact(session, "alpha", CHEST_ID);
    const after = session.dungeon.loot.length;

    expect(interact(session, "alpha", CHEST_ID)).toEqual({ ok: false, reason: "notPermitted" });

    expect(chest.opened).toBe(true);
    expect(session.dungeon.loot).toHaveLength(after);
  });

  it("refuses a player out of reach, leaving the chest closed", () => {
    const { session, chest } = vaultWithChest();
    session.players.get("alpha")!.position = at(2, 2);
    const before = session.dungeon.loot.length;

    expect(interact(session, "alpha", CHEST_ID)).toEqual({ ok: false, reason: "outOfRange" });

    expect(chest.opened).toBe(false);
    expect(session.dungeon.loot).toHaveLength(before);
  });

  it("refuses a downed player", () => {
    const { session, chest } = vaultWithChest();
    session.players.get("alpha")!.health = 0;

    expect(interact(session, "alpha", CHEST_ID)).toEqual({ ok: false, reason: "notPermitted" });
    expect(chest.opened).toBe(false);
  });

  it("keeps a locked chest shut without a key", () => {
    const { session, chest } = vaultWithChest(true);
    const before = session.dungeon.loot.length;

    expect(interact(session, "alpha", CHEST_ID)).toEqual({ ok: false, reason: "notPermitted" });

    expect(chest).toMatchObject({ opened: false, locked: true });
    expect(session.dungeon.loot).toHaveLength(before);
  });

  it("spends one key to open a locked chest", () => {
    const { session, chest } = vaultWithChest(true);
    const alpha = session.players.get("alpha")!;
    alpha.inventory = [KEY, { ...KEY, id: "c2222222-2222-4222-8222-222222222222" }];

    expect(interact(session, "alpha", CHEST_ID)).toEqual({ ok: true });

    expect(chest).toMatchObject({ opened: true, locked: false });
    expect(alpha.inventory).toHaveLength(1);
  });

  it("keeps a locked chest shut for a boss or vault key, which belong to doors", () => {
    const { session, chest } = vaultWithChest(true);
    const alpha = session.players.get("alpha")!;
    const bossKey = { ...KEY, itemId: "boss-key", name: "Boss Key" };
    alpha.inventory = [bossKey];

    expect(interact(session, "alpha", CHEST_ID)).toEqual({ ok: false, reason: "notPermitted" });

    expect(chest).toMatchObject({ opened: false, locked: true });
    expect(alpha.inventory).toEqual([bossKey]);
  });

  it("is shown only to players who can see its tile, opened or not", () => {
    const { session } = vaultWithChest();
    const far = testPlayer("far", { position: at(13, 6), carryingTorch: false });
    session.players.set("far", far);

    const near = visibilityFrameForPlayer(session, session.players.get("alpha")!);
    expect(near.dungeon.chests).toEqual([
      { id: CHEST_ID, lootTableId: TWO_TONICS.id, position: at(4, 4), opened: false, locked: false },
    ]);
    expect(JSON.stringify(visibilityFrameForPlayer(session, far))).not.toContain(CHEST_ID);

    interact(session, "alpha", CHEST_ID);
    expect(visibilityFrameForPlayer(session, session.players.get("alpha")!).dungeon.chests[0]?.opened).toBe(true);
  });
});

describe("generated chests", () => {
  /** Opens every chest in a freshly built run, in order, and records where each is and what it spilled. */
  function openEveryChest(seed: number): string[] {
    const request = { dungeonId: "vault-run", seed };
    const built = buildDungeon(request);
    const session = testSession([testPlayer("alpha")], "vault-run");
    session.dungeon = built.dungeon;
    session.runDungeon = request;
    session.lootRng = lootRngFor(built.seed, "vault-run");
    const alpha = session.players.get("alpha")!;

    return session.dungeon.chests.map((chest) => {
      const before = session.dungeon.loot.length;
      alpha.position = { ...chest.position };
      expect(interact(session, "alpha", chest.id)).toEqual({ ok: true });
      const spilled = session.dungeon.loot.slice(before).map((loot) => `${loot.name}@${loot.position.x},${loot.position.y}`);
      return `${chest.lootTableId}@${chest.position.x},${chest.position.y}:${spilled.join("|")}`;
    });
  }

  it("places the same chests with the same contents for the same seed", () => {
    const first = openEveryChest(TEST_SEED);

    // The boss room always holds one, so there is something to compare.
    expect(first.length).toBeGreaterThan(0);
    expect(openEveryChest(TEST_SEED)).toEqual(first);
  });

  it("places them on floor, clear of every other entity", () => {
    const { dungeon } = buildDungeon({ dungeonId: "vault-run", seed: TEST_SEED });
    const occupied = [
      ...dungeon.monsters.map((monster) => monster.position),
      ...dungeon.loot.map((loot) => loot.position),
      ...dungeon.traps.map((trap) => trap.position),
    ];

    for (const chest of dungeon.chests) {
      expect(isFloor(dungeon, chest.position)).toBe(true);
      expect(occupied.some((position) => distance(position, chest.position) === 0)).toBe(false);
    }
  });
});

describe("chest content validation", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function contentRoot(files: Record<string, unknown>): string {
    const root = mkdtempSync(join(tmpdir(), "dnd-chests-"));
    roots.push(root);
    for (const [path, body] of Object.entries(files)) {
      const file = join(root, path);
      mkdirSync(join(file, ".."), { recursive: true });
      writeFileSync(file, JSON.stringify(body));
    }
    return root;
  }

  const hall = (chests: unknown[]) => ({
    id: "hall",
    name: "Hall",
    kind: "hall",
    tiles: ["###", "#.#", "###"],
    doorways: [{ x: 0, y: 1, side: "west" }],
    chests,
  });

  it("refuses a template chest naming an unknown loot table", () => {
    const root = contentRoot({
      "dungeons/templates/hall.json": hall([{ lootTableId: "no-such-table", min: 1, max: 1 }]),
    });

    expect(() => loadContent(root)).toThrow(/unknown loot table "no-such-table"/);
  });

  it("refuses an authored chest naming an unknown loot table", () => {
    const root = contentRoot({
      "dungeons/vault.json": {
        id: "vault",
        name: "Vault",
        layout: "authored",
        tiles: ["###", "#.#", "###"],
        spawnPoints: [{ x: 1, y: 1 }],
        chests: [{ x: 1, y: 1, lootTableId: "no-such-table" }],
      },
    });

    expect(() => loadContent(root)).toThrow(/unknown loot table "no-such-table"/);
  });

  it("refuses a loot table naming an unknown item", () => {
    const root = contentRoot({
      "loot-tables/odd.json": { id: "odd", entries: [{ itemId: "no-such-item", weight: 1 }] },
    });

    expect(() => loadContent(root)).toThrow(/Loot table "odd" field entries.0.itemId names unknown item "no-such-item"/);
  });

  it("accepts a known table, and ships every template chest pointing at one", () => {
    const root = contentRoot({
      "items/tonic.json": {
        id: "tonic",
        name: "Tonic",
        kind: "consumable",
        description: "Restores health.",
        effects: [{ type: "heal", amount: 10 }],
      },
      "loot-tables/plain.json": { id: "plain", entries: [{ itemId: "tonic", weight: 1 }] },
      "dungeons/templates/hall.json": hall([{ lootTableId: "plain", min: 1, max: 1, locked: true }]),
    });

    expect(loadContent(root).templates.get("hall")?.chests).toEqual([
      { lootTableId: "plain", min: 1, max: 1, chance: 1, locked: true },
    ]);

    const shipped = gameContent();
    const rules = [...shipped.templates.values()].flatMap((template) => template.chests);
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) expect(shipped.lootTables.has(rule.lootTableId)).toBe(true);
  });
});
