import { expect, test } from "@playwright/test";

test.describe("Rebindable controls", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");
    await page.getByPlaceholder("Your name").fill("Maya");
    await page.getByRole("button", { name: "Create a new dungeon" }).click();
    await expect(page.locator(".hud__vitals")).toBeVisible();
    await page.getByRole("button", { name: "Controls" }).click();
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

    // The first spawn is two tiles west of the Dungeon Gate's column and several rows south: walk
    // east, then north until the gate is in reach.
    await page.keyboard.down("d");
    await page.waitForTimeout(1300);
    await page.keyboard.up("d");
    await page.keyboard.down("w");
    await expect(page.locator(".hud__prompt")).toContainText("[X]", { timeout: 15_000 });
    await page.keyboard.up("w");
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
