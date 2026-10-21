import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadContent } from "../../src/server/content/loadContent.js";
import { itemDefinitionSchema } from "../../src/server/content/schema.js";
import { lootInstance } from "../../src/server/game/dungeonBuilder.js";
import { consumeFromStack, dropItem, giveItem, pickupItem, useItem } from "../../src/server/game/items.js";
import { HUB_DUNGEON_ID } from "../../src/server/game/dungeonState.js";
import { profileFileSchema } from "../../src/server/profiles/profile.js";
import type { Session, SessionPlayer } from "../../src/server/sessions/sessionStore.js";
import { toPlayerState } from "../../src/server/sessions/sessionStore.js";
import { MAX_INVENTORY_SIZE } from "../../src/shared/constants/game.js";
import type { InventoryItem, LootState } from "../../src/shared/types/core.js";
import { inventoryItemSchema } from "../../src/shared/types/core.js";
import { at, MINOR_TONIC_ID, testPlayer, testSession, TONIC_FIELDS } from "./fixtures.js";

/** `content/items/arrow.json` ships a `maxStack` of 8. */
const ARROW_MAX = 8;

const TONIC: InventoryItem = { id: MINOR_TONIC_ID, name: "Minor Tonic", ...TONIC_FIELDS };

function tonics(count: number): InventoryItem[] {
  return Array.from({ length: count }, (_, index) => ({
    ...TONIC,
    id: `b0000000-0000-4000-8000-00000000000${index}`,
  }));
}

function arrows(id: string, count: number): InventoryItem {
  return { id, name: "Arrows", kind: "ammo", itemId: "arrow", count };
}

/** Puts a stack of arrows on the floor at `player`'s feet and returns it. */
function arrowsOnFloor(
  session: Session,
  player: SessionPlayer,
  id: string,
  count: number,
): Extract<LootState, { kind: "ammo" }> {
  const loot: Extract<LootState, { kind: "ammo" }> = {
    id,
    name: "Arrows",
    kind: "ammo",
    itemId: "arrow",
    count,
    position: { ...player.position },
    pickedUp: false,
  };
  session.dungeon.loot.push(loot);
  return loot;
}

const FIRST = "d0000000-0000-4000-8000-000000000001";
const SECOND = "d0000000-0000-4000-8000-000000000002";
const THIRD = "d0000000-0000-4000-8000-000000000003";

describe("ammo content", () => {
  const arrow = { id: "test-arrow", name: "Test Arrows", kind: "ammo", maxStack: 8 };

  it("accepts an ammo item and turns it into loot with a count clamped to maxStack", () => {
    const parsed = itemDefinitionSchema.parse(arrow);
    expect(lootInstance(parsed, { x: 1, y: 1 }, FIRST, 5)).toMatchObject({
      kind: "ammo",
      itemId: "test-arrow",
      count: 5,
    });
    expect(lootInstance(parsed, { x: 1, y: 1 }, FIRST, 50)).toMatchObject({ count: 8 });
    expect(lootInstance(parsed, { x: 1, y: 1 }, FIRST)).toMatchObject({ count: 1 });
  });

  it("rejects a missing, zero, negative, fractional, or absurd maxStack", () => {
    for (const maxStack of [undefined, 0, -1, 1.5, 1000]) {
      expect(itemDefinitionSchema.safeParse({ ...arrow, maxStack }).success).toBe(false);
    }
  });

  it("ships arrows and places a stack of five in the hub beside the sword", () => {
    const content = loadContent();
    expect(content.items.get("arrow")).toMatchObject({ kind: "ammo", maxStack: ARROW_MAX });

    const hub = testSession([], HUB_DUNGEON_ID);
    const stack = hub.dungeon.loot.find((loot) => loot.kind === "ammo");
    const sword = hub.dungeon.loot.find((loot) => loot.kind === "weapon");
    expect(stack).toMatchObject({ itemId: "arrow", count: 5, pickedUp: false });
    expect(stack && sword && Math.hypot(stack.position.x - sword.position.x, stack.position.y - sword.position.y))
      .toBeLessThanOrEqual(4);
  });

  describe("placements", () => {
    const roots: string[] = [];
    afterEach(() => {
      for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
    });

    function withPlacement(loot: Record<string, unknown>): string {
      const root = mkdtempSync(join(tmpdir(), "dnd-stacks-"));
      roots.push(root);
      const files: Record<string, unknown> = {
        "items/test-arrow.json": arrow,
        "items/test-key.json": { id: "test-key", name: "Key", kind: "key" },
        "dungeons/keep.json": {
          id: "keep",
          name: "Keep",
          layout: "authored",
          tiles: ["#####", "#...#", "#####"],
          spawnPoints: [{ x: 1, y: 1 }],
          loot: [{ x: 2, y: 1, ...loot }],
        },
      };
      for (const [path, body] of Object.entries(files)) {
        mkdirSync(join(root, path, ".."), { recursive: true });
        writeFileSync(join(root, path), JSON.stringify(body));
      }
      return root;
    }

    it("accepts a count up to maxStack", () => {
      expect(() => loadContent(withPlacement({ itemId: "test-arrow", count: 8 }))).not.toThrow();
    });

    it("refuses a count over maxStack, or a count on something that does not stack", () => {
      expect(() => loadContent(withPlacement({ itemId: "test-arrow", count: 9 }))).toThrow(/over its maxStack of 8/);
      expect(() => loadContent(withPlacement({ itemId: "test-key", count: 2 }))).toThrow(/does not stack/);
    });
  });
});

describe("picking up a stack", () => {
  it("merges a second pickup into the first stack, using one slot", () => {
    const player = testPlayer("alpha", { position: at(5, 5) });
    const session = testSession([player]);
    arrowsOnFloor(session, player, FIRST, 3);
    arrowsOnFloor(session, player, SECOND, 4);

    expect(pickupItem(session, "alpha", FIRST)).toEqual({ ok: true });
    expect(pickupItem(session, "alpha", SECOND)).toEqual({ ok: true });

    expect(player.inventory).toEqual([arrows(FIRST, 7)]);
    expect(session.dungeon.loot.find((loot) => loot.id === SECOND)?.pickedUp).toBe(true);
  });

  it("spills what overflows maxStack into the next free slot", () => {
    const player = testPlayer("alpha", { position: at(5, 5), inventory: [arrows(FIRST, 5)] });
    const session = testSession([player]);
    arrowsOnFloor(session, player, SECOND, 5);

    expect(pickupItem(session, "alpha", SECOND)).toEqual({ ok: true });

    expect(player.inventory).toEqual([arrows(FIRST, ARROW_MAX), arrows(SECOND, 2)]);
    expect(session.dungeon.loot.find((loot) => loot.id === SECOND)?.pickedUp).toBe(true);
  });

  it("leaves the remainder on the floor when there is no slot for the overflow", () => {
    const player = testPlayer("alpha", {
      position: at(5, 5),
      inventory: [arrows(FIRST, 6), ...tonics(MAX_INVENTORY_SIZE - 1)],
    });
    const session = testSession([player]);
    const loot = arrowsOnFloor(session, player, SECOND, 5);

    // A full inventory with a stack that is not full still takes arrows.
    expect(pickupItem(session, "alpha", SECOND)).toEqual({ ok: true });

    expect(player.inventory[0]).toEqual(arrows(FIRST, ARROW_MAX));
    expect(player.inventory).toHaveLength(MAX_INVENTORY_SIZE);
    expect(loot).toMatchObject({ id: SECOND, count: 3, pickedUp: false });
  });

  it("is refused, changing nothing, when every stack is full and there is no slot", () => {
    const player = testPlayer("alpha", {
      position: at(5, 5),
      inventory: [arrows(FIRST, ARROW_MAX), ...tonics(MAX_INVENTORY_SIZE - 1)],
    });
    const session = testSession([player]);
    const loot = arrowsOnFloor(session, player, SECOND, 2);

    expect(pickupItem(session, "alpha", SECOND)).toEqual({ ok: false, reason: "notPermitted" });
    expect(player.inventory[0]).toEqual(arrows(FIRST, ARROW_MAX));
    expect(loot).toMatchObject({ count: 2, pickedUp: false });
  });

  it("gives a partly taken stack a fresh id, so the floor and the slot never share one", () => {
    const player = testPlayer("alpha", { position: at(5, 5), inventory: tonics(MAX_INVENTORY_SIZE - 1) });
    const session = testSession([player]);
    const loot = arrowsOnFloor(session, player, FIRST, ARROW_MAX);
    // Stacks never exceed maxStack in play, but a lowered maxStack can leave an oversized one.
    loot.count = ARROW_MAX + 3;

    expect(pickupItem(session, "alpha", FIRST)).toEqual({ ok: true });

    const taken = player.inventory[MAX_INVENTORY_SIZE - 1];
    expect(taken).toMatchObject({ kind: "ammo", count: ARROW_MAX });
    expect(taken?.id).not.toBe(FIRST);
    expect(loot).toMatchObject({ count: 3, pickedUp: false });
  });

  it("serialises the count on the wire", () => {
    const player = testPlayer("alpha", { inventory: [arrows(FIRST, 5)] });
    const [wire] = toPlayerState(player).inventory;
    expect(inventoryItemSchema.parse(wire)).toEqual(arrows(FIRST, 5));
  });
});

describe("dropping and giving a stack", () => {
  it("drops the whole stack as one loot entry with its count", () => {
    const player = testPlayer("alpha", { position: at(5, 5), inventory: [arrows(FIRST, 6)] });
    const session = testSession([player]);

    expect(dropItem(session, "alpha", FIRST)).toEqual({ ok: true });

    expect(player.inventory).toEqual([]);
    expect(session.dungeon.loot.find((loot) => loot.id === FIRST)).toMatchObject({
      kind: "ammo",
      itemId: "arrow",
      count: 6,
      pickedUp: false,
    });
  });

  it("gives the whole stack into a free slot", () => {
    const giver = testPlayer("alpha", { position: at(5, 5), inventory: [arrows(FIRST, 6)] });
    const target = testPlayer("beta", { position: at(5, 5) });
    const session = testSession([giver, target]);

    expect(giveItem(session, "alpha", FIRST, "beta")).toEqual({ ok: true });

    expect(giver.inventory).toEqual([]);
    expect(target.inventory).toEqual([arrows(FIRST, 6)]);
  });

  it("merges a given stack into the target's stack, spilling the rest into a free slot", () => {
    const giver = testPlayer("alpha", { position: at(5, 5), inventory: [arrows(FIRST, 6)] });
    const target = testPlayer("beta", { position: at(5, 5), inventory: [arrows(SECOND, 5)] });
    const session = testSession([giver, target]);

    expect(giveItem(session, "alpha", FIRST, "beta")).toEqual({ ok: true });

    expect(giver.inventory).toEqual([]);
    expect(target.inventory).toEqual([arrows(SECOND, ARROW_MAX), arrows(FIRST, 3)]);
  });

  it("merges into a full inventory when the target's stack has room for all of it", () => {
    const giver = testPlayer("alpha", { position: at(5, 5), inventory: [arrows(FIRST, 2)] });
    const target = testPlayer("beta", {
      position: at(5, 5),
      inventory: [arrows(SECOND, 5), ...tonics(MAX_INVENTORY_SIZE - 1)],
    });
    const session = testSession([giver, target]);

    expect(giveItem(session, "alpha", FIRST, "beta")).toEqual({ ok: true });

    expect(giver.inventory).toEqual([]);
    expect(target.inventory[0]).toEqual(arrows(SECOND, 7));
  });

  it("refuses, changing nothing, when the target has no slot and no room to merge it all", () => {
    const giver = testPlayer("alpha", { position: at(5, 5), inventory: [arrows(FIRST, 6)] });
    const target = testPlayer("beta", {
      position: at(5, 5),
      inventory: [arrows(SECOND, 5), ...tonics(MAX_INVENTORY_SIZE - 1)],
    });
    const fullTarget = testPlayer("gamma", { position: at(5, 5), inventory: tonics(MAX_INVENTORY_SIZE) });
    const session = testSession([giver, target, fullTarget]);

    expect(giveItem(session, "alpha", FIRST, "beta")).toEqual({ ok: false, reason: "notPermitted" });
    expect(giveItem(session, "alpha", FIRST, "gamma")).toEqual({ ok: false, reason: "notPermitted" });

    expect(giver.inventory).toEqual([arrows(FIRST, 6)]);
    expect(target.inventory[0]).toEqual(arrows(SECOND, 5));
  });

  it("cannot be used on its own", () => {
    const player = testPlayer("alpha", { inventory: [arrows(FIRST, 3)] });
    const session = testSession([player]);

    expect(useItem(session, "alpha", FIRST)).toEqual({ ok: false, reason: "notPermitted" });
    expect(player.inventory).toEqual([arrows(FIRST, 3)]);
  });
});

describe("consuming from a stack", () => {
  it("decrements the stack and removes the entry at zero", () => {
    const player = testPlayer("alpha", { inventory: [arrows(FIRST, 2), TONIC] });

    expect(consumeFromStack(player, FIRST, 1)).toBe(true);
    expect(player.inventory[0]).toEqual(arrows(FIRST, 1));

    expect(consumeFromStack(player, FIRST, 1)).toBe(true);
    expect(player.inventory).toEqual([TONIC]);
  });

  it("consumes from a stack in the hand too", () => {
    const player = testPlayer("alpha", { held: arrows(FIRST, 1) });

    expect(consumeFromStack(player, FIRST, 1)).toBe(true);
    expect(player.held).toBeNull();
  });

  it("refuses, changing nothing, more than the stack holds, a bad amount, or something that is not ammo", () => {
    const player = testPlayer("alpha", { inventory: [arrows(FIRST, 2), TONIC] });

    expect(consumeFromStack(player, FIRST, 3)).toBe(false);
    expect(consumeFromStack(player, FIRST, 0)).toBe(false);
    expect(consumeFromStack(player, FIRST, 1.5)).toBe(false);
    expect(consumeFromStack(player, MINOR_TONIC_ID, 1)).toBe(false);
    expect(consumeFromStack(player, THIRD, 1)).toBe(false);
    expect(player.inventory).toEqual([arrows(FIRST, 2), TONIC]);
  });
});

describe("saved profiles", () => {
  const profile = (bankedItems: unknown[]) => ({
    version: 1,
    profiles: [
      {
        id: "33333333-3333-4333-8333-333333333333",
        secretHash: "a".repeat(64),
        displayName: "Grix",
        bankedItems,
        skillStacks: {},
        runsEscaped: 0,
        runsLost: 0,
        createdAt: 0,
        lastSeenAt: 0,
      },
    ],
  });

  it("loads banks written before stacks existed, and reads a stack without a count as one", () => {
    const parsed = profileFileSchema.parse(
      profile([
        { id: FIRST, name: "Copper Key", kind: "key" },
        { id: SECOND, name: "Minor Tonic", ...TONIC_FIELDS },
        { id: THIRD, name: "Arrows", kind: "ammo", itemId: "arrow" },
      ]),
    );

    expect(parsed.profiles[0]?.bankedItems).toEqual([
      { id: FIRST, name: "Copper Key", kind: "key" },
      { id: SECOND, name: "Minor Tonic", ...TONIC_FIELDS },
      arrows(THIRD, 1),
    ]);
  });

  it("keeps a banked stack's count, and refuses a nonsense one", () => {
    expect(profileFileSchema.parse(profile([arrows(FIRST, 6)])).profiles[0]?.bankedItems).toEqual([
      arrows(FIRST, 6),
    ]);
    expect(() => profileFileSchema.parse(profile([{ ...arrows(FIRST, 1), count: 0 }]))).toThrow();
  });
});
