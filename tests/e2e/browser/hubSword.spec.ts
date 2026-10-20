import { expect, test } from "@playwright/test";
import { enterHub } from "./designScreen.js";
import { walkTo } from "./walk.js";

/** World position of the hub's Rusted Sword, on the Weapons counter: authored (15.125, 5.3125). */
const SWORD = { x: 62, y: 22.75 };
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

test.describe("Hub sword", () => {
  test("a new player picks up the Rusted Sword in the hub and swings it, spending stamina", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/?debug");
    await page.getByPlaceholder("Your name").fill("Maya");
    await page.getByRole("button", { name: "Create a new dungeon" }).click();
    await enterHub(page);
    await expect(page.locator(".hud__vitals")).toBeVisible();
    await expect(page.locator(".hud__slot--held")).toHaveAttribute("aria-label", /Empty hand/);
    await expect(page.getByText("Position:")).toContainText(/\d+\.\d+, \d+\.\d+/);

    for (const waypoint of TO_WEAPONS) await walkTo(page, waypoint, 0.6);
    // Line up below the sword, then walk into the counter: it stops the player at its front, within
    // `INTERACT_RANGE` (1.2) of it, where the server's position agrees once it settles.
    await walkTo(page, { x: SWORD.x, y: SWORD.y + 1.75 }, 0.3);
    await page.keyboard.down("w");
    await page.waitForTimeout(400);
    await page.keyboard.up("w");
    // A hidden prompt keeps its last text, so only a visible one counts.
    await expect(page.locator(".hud__prompt", { hasText: "Pick up Rusted Sword" })).toBeVisible();

    const handSlot = page.locator(".hud__slot--held");
    await expect(async () => {
      await page.keyboard.press("f");
      await expect(handSlot).toHaveAttribute("aria-label", /In hand \(V\): Rusted Sword/, { timeout: 1000 });
    }).toPass({ timeout: 10_000 });

    const stamina = page.locator(".hud__bar--stamina");
    await expect(stamina).toHaveAttribute("aria-valuenow", "100");
    await page.keyboard.press(" ");
    // A hub swing hits nothing, but it is still paid for.
    await expect(stamina).not.toHaveAttribute("aria-valuenow", "100");
    await expect(page.locator(".hud__vitals")).toBeVisible();
  });
});
