import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { gameContent, loadContent, type GameContent } from "../../src/server/content/loadContent.js";
import type { LootTable } from "../../src/server/content/schema.js";
import { resolvePlayerAttack } from "../../src/server/game/combat.js";
import { lootInstance } from "../../src/server/game/dungeonBuilder.js";
import { rollLootTable } from "../../src/server/game/monsterLoot.js";
import { createRng } from "../../src/server/game/random.js";
import { visibilityFrameForPlayer } from "../../src/server/game/visibility.js";
import { isFloor } from "../../src/shared/game/movement.js";
import { buildDungeon } from "../../src/server/game/dungeonState.js";
import { lootRngFor } from "../../src/server/game/monsterLoot.js";
import type { Session } from "../../src/server/sessions/sessionStore.js";
import { ASH_IMP_ID, CINDER_SLIME_ID, TEST_SEED, at, monster, testPlayer, testSession } from "./fixtures.js";

const IN_REACH = 0.9;
const TONIC_TABLE: LootTable = { rolls: 1, entries: [{ itemId: "minor-tonic", weight: 1 }], nothingWeight: 0 };

/** The shipped content with `table` swapped onto the Ash Imp (or removed, when undefined). */
function contentWithImpLoot(table: LootTable | undefined): GameContent {
  const base = gameContent();
  const monsters = new Map(base.monsters);
  const imp = { ...monsters.get("ash-imp")! };
  if (table) imp.loot = table;
  else delete imp.loot;
  monsters.set("ash-imp", imp);
  return { ...base, monsters };
}

function vaultWith(content: GameContent, viewerPosition = at(11, 2, -IN_REACH)): Session {
  const request = { dungeonId: "ember-vault", seed: TEST_SEED, content };
  const built = buildDungeon(request);
  const session = testSession([testPlayer("alpha", { position: viewerPosition })]);
  session.dungeon = built.dungeon;
  session.runDungeon = request;
  session.lootRng = lootRngFor(built.seed, "ember-vault");
  return session;
}

function killImp(session: Session): void {
  monster(session, ASH_IMP_ID).health = 1;
  const result = resolvePlayerAttack(session, "alpha", { x: 1, y: 0 }, null, 0);
  expect(result.ok && result.event.targetDefeated).toBe(true);
}

const droppedNames = (session: Session, baseline: number): string[] =>
  session.dungeon.loot.slice(baseline).map((loot) => loot.name);

describe("monster loot drops", () => {
  it("drops exactly the guaranteed entry on death", () => {
    const session = vaultWith(contentWithImpLoot(TONIC_TABLE));
    const before = session.dungeon.loot.length;

    killImp(session);

    expect(droppedNames(session, before)).toEqual(["Minor Tonic"]);
    expect(session.dungeon.loot.at(-1)).toMatchObject({ kind: "consumable", itemId: "minor-tonic", pickedUp: false });
  });

  it("drops nothing for a monster without a table", () => {
    const session = vaultWith(contentWithImpLoot(undefined));
    const before = session.dungeon.loot.length;

    killImp(session);

    expect(session.dungeon.loot).toHaveLength(before);
  });

  it("drops nothing while the monster is only wounded", () => {
    const session = vaultWith(contentWithImpLoot(TONIC_TABLE));
    const before = session.dungeon.loot.length;

    resolvePlayerAttack(session, "alpha", { x: 1, y: 0 }, null, 0);

    expect(monster(session, ASH_IMP_ID).alive).toBe(true);
    expect(session.dungeon.loot).toHaveLength(before);
  });

  it("places a drop on open floor, off a door, when the corpse tile is crowded", () => {
    const session = vaultWith(contentWithImpLoot(TONIC_TABLE));
    const corpse = monster(session, ASH_IMP_ID).position;
    const tonic = gameContent().items.get("minor-tonic")!;
    session.dungeon.loot.push(lootInstance(tonic, corpse, "crowd-1"));
    const before = session.dungeon.loot.length;

    killImp(session);

    const dropped = session.dungeon.loot[before]!;
    expect(session.dungeon.loot).toHaveLength(before + 1);
    expect(dropped.position).not.toEqual(corpse);
    expect(isFloor(session.dungeon, dropped.position)).toBe(true);
    expect(
      session.dungeon.doors.some(
        (door) =>
          Math.abs(Math.round(dropped.position.x) - door.position.x) < door.size / 2 &&
          Math.abs(Math.round(dropped.position.y) - door.position.y) < door.size / 2,
      ),
    ).toBe(false);
  });

  it("never lands a drop in a wall when the corpse hugs one", () => {
    const session = vaultWith(contentWithImpLoot({ ...TONIC_TABLE, rolls: 6 }));

    killImp(session);

    for (const loot of session.dungeon.loot.slice(-6)) {
      expect(isFloor(session.dungeon, loot.position)).toBe(true);
    }
  });

  it("repeats the same drops for the same seed and kill order", () => {
    const table: LootTable = {
      rolls: 1,
      entries: [{ itemId: "minor-tonic", weight: 1 }],
      nothingWeight: 1,
    };
    const run = (): string[] => {
      const rng = createRng(1234);
      return Array.from({ length: 20 }, () => rollLootTable(table, rng).join(",") || "-");
    };

    const first = run();
    expect(run()).toEqual(first);
    expect(new Set(first).size).toBe(2);

    const kills = (): string[] => {
      const content = contentWithImpLoot({ ...table, rolls: 4 });
      const session = vaultWith(content);
      killImp(session);
      return session.dungeon.loot.slice(-4).map((loot) => `${loot.name}@${loot.position.x},${loot.position.y}:${loot.id}`);
    };
    expect(kills()).toEqual(kills());
  });

  it("shows a drop only to players who can see its tile", () => {
    const session = vaultWith(contentWithImpLoot(TONIC_TABLE));
    const far = testPlayer("far", { position: at(2, 2) });
    session.players.set("far", far);
    const before = session.dungeon.loot.length;

    killImp(session);
    const dropped = session.dungeon.loot[before]!;

    const near = visibilityFrameForPlayer(session, session.players.get("alpha")!);
    const away = visibilityFrameForPlayer(session, far);
    expect(near.dungeon.loot.some((loot) => loot.id === dropped.id)).toBe(true);
    expect(away.dungeon.loot.some((loot) => loot.id === dropped.id)).toBe(false);
    expect(JSON.stringify(away)).not.toContain(dropped.id);
  });

  it("ships the Ember Warden with a guaranteed rare drop and common monsters with light ones", () => {
    const { monsters } = gameContent();
    expect(monsters.get("ember-warden")?.loot).toMatchObject({ entries: [{ itemId: "iron-will-scroll" }], nothingWeight: 0 });
    expect(monsters.get("ash-imp")?.loot?.nothingWeight).toBeGreaterThan(0);
    expect(CINDER_SLIME_ID).toBeTruthy();
    expect(monsters.get("cinder-slime")?.loot?.entries.length).toBeGreaterThan(0);
  });
});

describe("skill scroll monster drops", () => {
  it("lets ordinary monsters drop skill scrolls, rarely", () => {
    const { items, monsters } = gameContent();
    const isScroll = (itemId: string): boolean => items.get(itemId)?.kind === "skillScroll";
    const ordinary = [...monsters.values()].filter(
      (type) => !type.boss && type.loot?.entries.some((entry) => isScroll(entry.itemId)),
    );
    expect(ordinary.length).toBeGreaterThan(0);

    const kills = 10_000;
    for (const type of ordinary) {
      const rng = createRng(TEST_SEED);
      let scrolls = 0;
      for (let kill = 0; kill < kills; kill += 1) {
        scrolls += rollLootTable(type.loot!, rng).filter(isScroll).length;
      }
      expect(scrolls, type.id).toBeGreaterThan(0);
      expect(scrolls / kills, type.id).toBeLessThan(0.03);
    }
  });
});

describe("monster loot table validation", () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("names the monster and field when a table drops an unknown item", () => {
    const root = mkdtempSync(join(tmpdir(), "dnd-loot-"));
    roots.push(root);
    mkdirSync(join(root, "monsters"), { recursive: true });
    writeFileSync(
      join(root, "monsters", "bad-imp.json"),
      JSON.stringify({
        id: "bad-imp",
        name: "Bad Imp",
        maxHealth: 5,
        speed: 1,
        aggroRange: 5,
        attackRange: 1,
        damage: 1,
        attackCooldownMs: 1000,
        loot: { entries: [{ itemId: "no-such-item", weight: 1 }] },
      }),
    );

    expect(() => loadContent(root)).toThrow(
      /Monster "bad-imp" field loot\.entries\.0\.itemId names unknown item "no-such-item"/,
    );
  });

  it("names the file and field when a table is malformed", () => {
    const root = mkdtempSync(join(tmpdir(), "dnd-loot-"));
    roots.push(root);
    mkdirSync(join(root, "monsters"), { recursive: true });
    writeFileSync(
      join(root, "monsters", "empty-imp.json"),
      JSON.stringify({
        id: "empty-imp",
        name: "Empty Imp",
        maxHealth: 5,
        speed: 1,
        aggroRange: 5,
        attackRange: 1,
        damage: 1,
        attackCooldownMs: 1000,
        loot: { entries: [] },
      }),
    );

    expect(() => loadContent(root)).toThrow(/empty-imp\.json is not valid content: loot\.entries/);
  });
});

describe("an elite's vault key", () => {
  const vaultKeys = (session: Session) =>
    session.dungeon.loot.filter((loot) => loot.kind === "key" && loot.itemId === "vault-key");

  function eliteImp(content: GameContent): Session {
    const session = vaultWith(content);
    const imp = monster(session, ASH_IMP_ID);
    imp.elite = true;
    imp.health = 1;
    return session;
  }

  it("drops on death even when the monster's own table is empty", () => {
    const session = eliteImp(contentWithImpLoot(undefined));
    expect(vaultKeys(session)).toHaveLength(0);

    killImp(session);

    const [key] = vaultKeys(session);
    expect(vaultKeys(session)).toHaveLength(1);
    expect(key).toMatchObject({ name: "Vault Key", pickedUp: false });
    expect(isFloor(session.dungeon, key!.position)).toBe(true);
  });

  it("drops once, beside the table's own drops", () => {
    const session = eliteImp(contentWithImpLoot(TONIC_TABLE));
    const before = session.dungeon.loot.length;

    killImp(session);

    expect(droppedNames(session, before).sort()).toEqual(["Minor Tonic", "Vault Key"]);
  });

  it("is not lost when a different player lands the killing blow", () => {
    const session = eliteImp(contentWithImpLoot(undefined));
    session.players.set("beta", testPlayer("beta", { position: at(11, 2, -IN_REACH) }));
    // Beta, not the player who was fighting it, finishes it.
    const imp = monster(session, ASH_IMP_ID);
    imp.health = 2;
    imp.maxHealth = 30;

    const result = resolvePlayerAttack(session, "beta", { x: 1, y: 0 }, null, 0);

    expect(result.ok && result.event.targetDefeated).toBe(true);
    expect(vaultKeys(session)).toHaveLength(1);
    expect(vaultKeys(session)[0]!.pickedUp).toBe(false);
  });

  it("is never dropped by an ordinary monster", () => {
    const session = vaultWith(contentWithImpLoot(undefined));
    monster(session, ASH_IMP_ID).health = 1;

    killImp(session);

    expect(vaultKeys(session)).toHaveLength(0);
  });
});
