import { expect, test } from "@playwright/test";
import { campMenu, openCampMenu } from "./campMenu.js";
import { enterHub } from "./designScreen.js";

test.describe("Skills panel", () => {
  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 390, height: 600 },
  ]) {
    test(`lists the catalog from server state and fits a ${viewport.width}x${viewport.height} viewport`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize(viewport);
      await page.goto("/");
      await page.getByPlaceholder("Your name").fill("Maya");
      await page.getByRole("button", { name: "Create a new dungeon" }).click();
      await enterHub(page);

      const panel = page.getByRole("dialog", { name: "Skills" });
      await expect(panel).toBeHidden();
      await (await openCampMenu(page)).getByRole("button", { name: "Skills" }).click();
      await expect(campMenu(page)).toBeHidden();
      await expect(panel).toBeVisible();

      // A fresh profile holds nothing, so every skill is locked and says how it is earned.
      await expect(panel.locator(".hud__skill--locked").first()).toContainText("Found as a skill scroll");
      await expect(panel).toContainText("Iron Will");
      await expect(panel).toContainText("Coin 0");
      await expect(panel.locator(".hud__skill--permanent, .hud__skill--provisional")).toHaveCount(0);

      const box = await panel.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
      expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
      await page.screenshot({ path: testInfo.outputPath(`skills-${viewport.width}.png`) });

      // Escape shuts the panel rather than opening the camp menu over it.
      await page.keyboard.press("Escape");
      await expect(panel).toBeHidden();
      await expect(campMenu(page)).toBeHidden();
    });
  }
});
