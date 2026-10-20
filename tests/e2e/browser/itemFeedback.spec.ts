import { expect, test, type Page } from "@playwright/test";
import { enterHub } from "./designScreen.js";

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

/**
 * Counts the feedback animations as they start. Both last well under a second, so polling the DOM
 * afterwards could miss them, and an animation that starts is one the stylesheet actually played.
 */
const WATCH_FEEDBACK = `(() => {
  const seen = { flyIns: 0, heldPulses: 0 };
  window.itemFeedbackSeen = seen;
  document.addEventListener("animationstart", (event) => {
    const classes = event.target.classList;
    if (classes.contains("hud__fly-icon")) seen.flyIns += 1;
    if (classes.contains("hud__slot--held")) seen.heldPulses += 1;
  });
})()`;

interface FeedbackSeen {
  flyIns: number;
  heldPulses: number;
}

async function watchFeedback(page: Page): Promise<void> {
  await page.evaluate(WATCH_FEEDBACK);
}

async function feedback(page: Page): Promise<FeedbackSeen> {
  return page.evaluate<FeedbackSeen>("({ ...window.itemFeedbackSeen })");
}

async function pickUpSword(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/?debug");
  await page.getByPlaceholder("Your name").fill("Maya");
  await page.getByRole("button", { name: "Create a new dungeon" }).click();
  await enterHub(page);
  await expect(page.getByText("Position:")).toContainText(/\d+\.\d+, \d+\.\d+/);

  for (const waypoint of TO_WEAPONS) await walkTo(page, waypoint, 0.6);
  await walkTo(page, { x: SWORD.x, y: SWORD.y + 1.75 }, 0.3);
  await page.keyboard.down("w");
  await page.waitForTimeout(400);
  await page.keyboard.up("w");
  await expect(page.locator(".hud__prompt", { hasText: "Pick up Rusted Sword" })).toBeVisible();

  await watchFeedback(page);
  const handSlot = page.locator(".hud__slot--held");
  await expect(async () => {
    await page.keyboard.press("f");
    await expect(handSlot).toHaveAttribute("aria-label", /In hand \(V\): Rusted Sword/, { timeout: 1000 });
  }).toPass({ timeout: 10_000 });
}

test.describe("Item feedback", () => {
  // The walk to the Weapons stall alone takes most of the default 30 s on a loaded machine.
  test.describe.configure({ timeout: 60_000 });

  test("a picked-up sword flies into the hand slot, which then pulses", async ({ page }) => {
    await pickUpSword(page);
    await expect.poll(() => feedback(page)).toEqual({ flyIns: 1, heldPulses: 1 });
    // The icon is gone once it lands, and it never took the pointer.
    await expect(page.locator(".hud__fly-icon")).toHaveCount(0);
  });

  test("with reduced motion, the pickup is only a highlight on the hand slot", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await pickUpSword(page);
    await expect(page.locator("html")).toHaveAttribute("data-reduced-motion", "true");
    await expect.poll(() => feedback(page)).toEqual({ flyIns: 0, heldPulses: 1 });
  });
});
