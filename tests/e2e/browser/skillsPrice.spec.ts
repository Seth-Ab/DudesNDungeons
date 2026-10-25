import { expect, test, type Page } from "@playwright/test";
import { openCampMenu } from "./campMenu.js";
import { enterHub } from "./designScreen.js";
import { walkTo } from "./walk.js";

const TORCH = { x: 25.5, y: 22.75 };
const GATE = { x: 45.5, y: 5.5 };
const TO_TORCHES = [
  { x: 33.5, y: 29.5 },
  { x: 33.5, y: 25.5 },
];
const TO_GATE = [
  { x: 33.5, y: 25.5 },
  { x: 33.5, y: 17.5 },
  { x: 45.5, y: 17.5 },
];

async function startRun(page: Page): Promise<void> {
  for (const waypoint of TO_TORCHES) await walkTo(page, waypoint, 0.6);
  await walkTo(page, { x: TORCH.x, y: TORCH.y + 1.75 }, 0.3);
  await page.keyboard.down("w");
  await page.waitForTimeout(400);
  await page.keyboard.up("w");
  await page.keyboard.press("f");
  await page.getByRole("button", { name: "Ready" }).click();
  for (const waypoint of TO_GATE) await walkTo(page, waypoint, 0.6);
  await walkTo(page, GATE, 1);
  await expect(async () => {
    await page.keyboard.press("e");
    await expect(page.locator(".hud__tally")).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
}

async function openSkills(page: Page) {
  await (await openCampMenu(page)).getByRole("button", { name: "Skills" }).click();
  const panel = page.getByRole("dialog", { name: "Skills" });
  await expect(panel).toBeVisible();
  return panel;
}

test.describe("Skills panel shop prices", () => {
  test("shows the server's scroll price in the hub and in the dungeon", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await page.goto("/?debug");
    await page.getByPlaceholder("Your name").fill("Maya");
    await page.getByRole("button", { name: "Create a new dungeon" }).click();
    await enterHub(page);

    // Iron Will is always in stock; the other two scrolls rotate, one at a time.
    let panel = await openSkills(page);
    const ironWill = panel.locator(".hud__skill", { hasText: "Iron Will" });
    await expect(ironWill).toContainText("Sold at the hub shop - 20 coin");
    await expect(panel.getByText("Sometimes sold at the hub shop")).toHaveCount(1);
    await expect(panel.getByText(/Sold at the hub shop - 12 coin \(rotating stock\)/)).toHaveCount(1);
    await page.screenshot({ path: testInfo.outputPath("skills-price-hub.png") });
    await page.keyboard.press("Escape");

    await startRun(page);
    panel = await openSkills(page);
    await expect(panel.locator(".hud__skill", { hasText: "Iron Will" })).toContainText("Sold at the hub shop - 20 coin");
    await page.screenshot({ path: testInfo.outputPath("skills-price-dungeon.png") });
  });
});
