import { expect, test, type Page } from "@playwright/test";
import { enterHub } from "./designScreen.js";

/** World position of the hub's arrow stack, on the Weapons counter: authored (15.875, 5.3125). */
const ARROWS = { x: 65, y: 22.75 };
/**
 * From the first spawn, west of the fountain, round the north of the plaza to the floor in front of
 * the Weapons stall: the fountain and its benches stand in the straight line.
 */
const TO_WEAPONS = [
  { x: 33.5, y: 29.5 },
  { x: 33.5, y: 17.5 },
  { x: 57.5, y: 17.5 },
  { x: 57.5, y: 25.5 },
];

async function position(page: Page): Promise<{ x: number; y: number }> {
  const text = (await page.getByText("Position:").textContent()) ?? "";
  const [x, y] = (text.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  if (x === undefined || y === undefined) throw new Error(`No position in "${text}"`);
  return { x, y };
}

/**
 * Walks until the predicted position is within `reach` of `target`, steering by the debug readout
 * rather than by time, so a loaded machine that moves fewer steps per second still arrives.
 */
async function walkTo(page: Page, target: { x: number; y: number }, reach: number): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const at = await position(page);
    const dx = target.x - at.x;
    const dy = target.y - at.y;
    if (Math.hypot(dx, dy) <= reach) return;

    const key = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? "d" : "a") : dy > 0 ? "s" : "w";
    await page.keyboard.down(key);
    await page.waitForTimeout(Math.max(Math.abs(dx), Math.abs(dy)) > 2 ? 200 : 40);
    await page.keyboard.up(key);
  }
  throw new Error(`Never reached ${JSON.stringify(target)}`);
}

test.describe("Hub arrows", () => {
  test("a new player picks up the hub's stack of arrows into one slot showing its count", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/?debug");
    await page.getByPlaceholder("Your name").fill("Maya");
    await page.getByRole("button", { name: "Create a new dungeon" }).click();
    await enterHub(page);
    await expect(page.locator(".hud__vitals")).toBeVisible();
    await expect(page.getByText("Position:")).toContainText(/\d+\.\d+, \d+\.\d+/);

    for (const waypoint of TO_WEAPONS) await walkTo(page, waypoint, 0.6);
    // Line up below the arrows, then walk into the counter: it stops the player at its front, within
    // `INTERACT_RANGE` (1.2) of it, where the server's position agrees once it settles.
    await walkTo(page, { x: ARROWS.x, y: ARROWS.y + 1.75 }, 0.3);
    await page.keyboard.down("w");
    await page.waitForTimeout(400);
    await page.keyboard.up("w");
    // A hidden prompt keeps its last text, so only a visible one counts.
    await expect(page.locator(".hud__prompt", { hasText: "Pick up Arrows (5)" })).toBeVisible();

    const firstSlot = page.locator(".hud__slot:not(.hud__slot--held)").first();
    await expect(async () => {
      await page.keyboard.press("f");
      await expect(firstSlot).toHaveAttribute("aria-label", /Slot 1: Arrows \(5\)/, { timeout: 1000 });
    }).toPass({ timeout: 10_000 });

    await expect(firstSlot.locator(".hud__slot-count")).toHaveText("5");
    await expect(firstSlot.locator(".hud__slot-count")).toBeVisible();
    // One stack, one slot: the other two stay empty.
    await expect(page.locator(".hud__slot--empty:not(.hud__slot--held)")).toHaveCount(2);
  });
});
