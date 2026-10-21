import { expect, test } from "@playwright/test";
import { openCampMenu } from "./campMenu.js";
import { enterHub } from "./designScreen.js";

test.describe("HUD fade", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");
    await page.getByPlaceholder("Your name").fill("Maya");
    await page.getByRole("button", { name: "Create a new dungeon" }).click();
    await enterHub(page);
    await expect(page.locator(".hud__hotbar")).toBeVisible();
  });

  test("a quiet module dims after four seconds and a key press restores it", async ({ page }) => {
    const hotbar = page.locator(".hud__hotbar");
    await expect(hotbar).toHaveAttribute("data-faded", "true", { timeout: 10_000 });
    await expect(hotbar).toHaveCSS("opacity", "0.55", { timeout: 2000 });

    await page.keyboard.press("Shift");
    await expect(hotbar).toHaveAttribute("data-faded", "false");
    await expect(hotbar).toHaveCSS("opacity", "1", { timeout: 2000 });
  });

  test("the camp menu pins every module at full opacity", async ({ page }) => {
    await expect(page.locator(".hud__hotbar")).toHaveAttribute("data-faded", "true", { timeout: 10_000 });
    await openCampMenu(page);
    await expect(page.locator(".hud__hotbar")).toHaveAttribute("data-faded", "false");
    await page.waitForTimeout(4500);
    await expect(page.locator(".hud__hotbar")).toHaveAttribute("data-faded", "false");
  });

  test("with reduced motion the change is instant", async ({ page }) => {
    await (await openCampMenu(page)).getByRole("button", { name: "Controls" }).click();
    await page.getByLabel(/Reduce motion/).check();
    await page.keyboard.press("Escape");

    const hotbar = page.locator(".hud__hotbar");
    await expect(hotbar).toHaveAttribute("data-faded", "true", { timeout: 10_000 });
    await expect(hotbar).toHaveCSS("transition-duration", "0s");
    await expect(hotbar).toHaveCSS("opacity", "0.55");
  });
});
