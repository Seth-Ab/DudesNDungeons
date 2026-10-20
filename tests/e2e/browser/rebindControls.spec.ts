import { expect, test, type Page } from "@playwright/test";
import { openCampMenu } from "./campMenu.js";
import { enterHub } from "./designScreen.js";

/**
 * From the first spawn, west of the fountain, round the benches on the north of the plaza to the
 * foot of the gate road, in world units.
 */
const TO_GATE_ROAD = [
  { x: 33.5, y: 29.5 },
  { x: 33.5, y: 17.5 },
  { x: 45.5, y: 17.5 },
];

async function position(page: Page): Promise<{ x: number; y: number }> {
  const text = (await page.getByText("Position:").textContent()) ?? "";
  const [x, y] = (text.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  if (x === undefined || y === undefined) throw new Error(`No position in "${text}"`);
  return { x, y };
}

/** Walks until the predicted position is within `reach` of `target`, steering by the debug readout. */
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

test.describe("Rebindable controls", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    // The debug readout, so the walk to the gate can steer by position rather than by time.
    await page.goto("/?debug");
    await page.getByPlaceholder("Your name").fill("Maya");
    await page.getByRole("button", { name: "Create a new dungeon" }).click();
    await enterHub(page);
    await expect(page.locator(".hud__vitals")).toBeVisible();
    await (await openCampMenu(page)).getByRole("button", { name: "Controls" }).click();
  });

  test("rebinding Interact updates the Controls menu rows at once", async ({ page }) => {
    await page.getByRole("button", { name: "Interact: E" }).click();
    await page.keyboard.press("x");

    await expect(page.getByRole("button", { name: "Interact: X" })).toBeVisible();
    await expect(page.locator(".controls-menu__message")).toHaveText("Interact is now X.");
    // The Hub rows reuse the interact key and show it too.
    await expect(page.locator(".controls-menu__group", { hasText: "The Hub" })).toContainText("X");
  });

  test("a rebound Interact key shows in the contextual prompt in a real render", async ({ page }) => {
    await page.getByRole("button", { name: "Interact: E" }).click();
    await page.keyboard.press("x");
    await page.getByRole("button", { name: "Close" }).click();

    // The fountain stands between the first spawn and the gate: go round it to the gate road, then
    // north until the gate is in reach.
    for (const waypoint of TO_GATE_ROAD) await walkTo(page, waypoint, 0.6);
    await page.keyboard.down("w");
    await expect(page.locator(".hud__prompt")).toContainText("[X]", { timeout: 15_000 });
    await page.keyboard.up("w");
  });

  test("the swap key is listed, rebindable, and labels the hand slot beside the hotbar", async ({ page }) => {
    const handSlot = page.locator(".hud__slot--held");
    await expect(handSlot).toHaveAttribute("aria-label", /In hand \(V\)/);

    await page.getByRole("button", { name: "Swap held item: V" }).click();
    await page.keyboard.press("z");
    await expect(page.getByRole("button", { name: "Swap held item: Z" })).toBeVisible();
    await expect(handSlot).toHaveAttribute("aria-label", /In hand \(Z\)/);
  });

  test("a held key is rejected with a message, Escape cancels, and reset restores defaults", async ({ page }) => {
    await page.getByRole("button", { name: "Interact: E" }).click();
    await page.keyboard.press("f");
    await expect(page.locator(".controls-menu__message")).toHaveText("F is already bound to Pick up.");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Interact: E" })).toBeVisible();
    // Escape cancelled capture rather than closing the menu.
    await expect(page.locator(".controls-menu")).toBeVisible();

    await page.getByRole("button", { name: "Interact: E" }).click();
    await page.keyboard.press("x");
    await page.getByRole("button", { name: "Reset to defaults" }).click();
    await expect(page.getByRole("button", { name: "Interact: E" })).toBeVisible();
  });
});
