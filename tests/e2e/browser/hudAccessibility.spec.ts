import { expect, test } from "@playwright/test";

test.describe("HUD accessibility and layout", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");
    await page.getByPlaceholder("Your name").fill("Maya");
    await page.getByRole("button", { name: "Create a new dungeon" }).click();
    await expect(page.locator(".hud__vitals")).toBeVisible();
  });

  test("renders every HUD cluster inside the viewport without covering the canvas centre", async ({ page }, testInfo) => {
    const viewport = page.viewportSize()!;
    for (const selector of [
      ".hud__panel--status",
      ".hud__panel--session",
      ".hud__panel--party",
      ".hud__panel--actions",
      ".hud__hotbar",
      ".hud__hub-status",
    ]) {
      const box = await page.locator(selector).first().boundingBox();
      expect(box, selector).not.toBeNull();
      expect(box!.x, selector).toBeGreaterThanOrEqual(0);
      expect(box!.y, selector).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width, selector).toBeLessThanOrEqual(viewport.width);
      expect(box!.y + box!.height, selector).toBeLessThanOrEqual(viewport.height);
    }

    // A trial click fails if an overlay intercepts the pointer at the canvas centre.
    await page.locator("canvas").click({
      position: { x: viewport.width / 2, y: viewport.height / 2 },
      trial: true,
    });
    await page.screenshot({ path: testInfo.outputPath("hud-full.png") });
  });

  test("vitals are told apart by glyph, not colour alone", async ({ page }) => {
    const glyphs = await page.locator(".hud__vitals .hud__bar-label").allTextContents();
    expect(new Set(glyphs).size).toBe(glyphs.length);
  });

  test("reduced motion and UI scale apply and persist across a reload", async ({ page }) => {
    await page.getByRole("button", { name: "Controls" }).click();
    const reduce = page.getByLabel(/Reduce motion/);
    await reduce.check();
    await page.getByLabel("UI scale").selectOption("1.3");

    await expect(page.locator("html")).toHaveAttribute("data-reduced-motion", "true");
    await expect(page.locator("html")).toHaveAttribute("style", /font-size: 130%/);

    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-reduced-motion", "true");
    await expect(page.locator("html")).toHaveAttribute("style", /font-size: 130%/);
  });
});
