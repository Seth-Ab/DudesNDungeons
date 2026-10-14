import { expect, test, type Page } from "@playwright/test";

/** World position of the hub's Rusted Sword: authored tile (10, 8), centred in its 4x4 block. */
const SWORD = { x: 41.5, y: 33.5 };

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

test.describe("Hub sword", () => {
  test("a new player picks up the Rusted Sword in the hub and swings it, spending stamina", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/?debug");
    await page.getByPlaceholder("Your name").fill("Maya");
    await page.getByRole("button", { name: "Create a new dungeon" }).click();
    await expect(page.locator(".hud__vitals")).toBeVisible();
    await expect(page.locator(".hud__slot--held")).toHaveAttribute("aria-label", /Empty hand/);
    await expect(page.getByText("Position:")).toContainText(/\d+\.\d+, \d+\.\d+/);

    // Well inside `INTERACT_RANGE` (1.2), so the server's position agrees once it settles.
    await walkTo(page, SWORD, 0.6);
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
