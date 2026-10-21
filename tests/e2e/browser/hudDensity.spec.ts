import { expect, test, type Page } from "@playwright/test";
import { openCampMenu } from "./campMenu.js";
import { enterHub } from "./designScreen.js";

async function chooseDensity(page: Page, label: RegExp): Promise<void> {
  await (await openCampMenu(page)).getByRole("button", { name: "Controls" }).click();
  await page.getByLabel("HUD density").selectOption({ label: await optionLabel(page, label) });
  await page.keyboard.press("Escape");
}

async function optionLabel(page: Page, label: RegExp): Promise<string> {
  const labels = await page.getByLabel("HUD density").locator("option").allTextContents();
  const match = labels.find((text) => label.test(text));
  if (!match) throw new Error(`No HUD density option matches ${label}`);
  return match;
}

test.describe("HUD density", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");
    await page.getByPlaceholder("Your name").fill("Maya");
    await page.getByRole("button", { name: "Create a new dungeon" }).click();
    await enterHub(page);
    await expect(page.locator(".hud__hotbar")).toBeVisible();
  });

  test("Calm is the default: modules fade to 55% and the key hints stay", async ({ page }) => {
    await expect(page.locator("html")).toHaveAttribute("data-hud-density", "calm");
    await expect(page.locator(".hud__hotbar")).toHaveCSS("opacity", "0.55", { timeout: 10_000 });
    await expect(page.locator(".hud__hint:not(.hud__hint--camp)").first()).toBeVisible();
    await page.screenshot({ path: "test-results/hud-density-calm.png" });
  });

  test("Full never fades", async ({ page }) => {
    await chooseDensity(page, /^Full/);
    await page.waitForTimeout(5000);
    await expect(page.locator(".hud__hotbar")).toHaveAttribute("data-faded", "false");
    await expect(page.locator(".hud__hotbar")).toHaveCSS("opacity", "1");
    await page.screenshot({ path: "test-results/hud-density-full.png" });
  });

  test("Minimal fades lower and hides the key hints but keeps the camp button", async ({ page }) => {
    await chooseDensity(page, /^Minimal/);
    await expect(page.locator(".hud__hotbar")).toHaveCSS("opacity", "0.35", { timeout: 10_000 });
    await expect(page.locator(".hud__hint:not(.hud__hint--camp)").first()).toBeHidden();
    await expect(page.locator(".hud__hint--camp")).toBeVisible();
    await page.screenshot({ path: "test-results/hud-density-minimal.png" });
  });

  test("the choice persists across a reload", async ({ page }) => {
    await chooseDensity(page, /^Minimal/);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-hud-density", "minimal");
  });
});
