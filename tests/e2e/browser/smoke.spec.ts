import { expect, test } from "@playwright/test";

test("client boots and renders the canvas", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("DudesNDungeons");
  await expect(page.locator("#app canvas")).toBeVisible();
});

test.describe("HUD overlay", () => {
  for (const viewport of [
    { width: 1024, height: 600 },
    { width: 1440, height: 900 },
  ]) {
    test(`floats over a full-viewport canvas at ${viewport.width}x${viewport.height}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto("/");

      const canvas = await page.locator("#app canvas").boundingBox();
      expect(canvas).toMatchObject({ x: 0, y: 0, ...viewport });

      const panels = await page.locator(".hud__panel:not([hidden])").evaluateAll((elements) =>
        elements.map((element) => {
          const { left, top, right, bottom } = element.getBoundingClientRect();
          return { left, top, right, bottom };
        }),
      );
      expect(panels).toHaveLength(4);
      for (const panel of panels) {
        expect(panel.left).toBeGreaterThanOrEqual(0);
        expect(panel.top).toBeGreaterThanOrEqual(0);
        expect(panel.right).toBeLessThanOrEqual(viewport.width);
        expect(panel.bottom).toBeLessThanOrEqual(viewport.height);
      }
      for (let i = 0; i < panels.length; i += 1) {
        for (let j = i + 1; j < panels.length; j += 1) {
          const a = panels[i]!;
          const b = panels[j]!;
          const overlaps = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
          expect(overlaps, `panels ${i} and ${j} overlap`).toBe(false);
        }
      }
    });
  }

  test("hides the position readout until the debug key is pressed", async ({ page }) => {
    await page.goto("/");
    const position = page.getByText("Position:");
    // The lobby focuses its name field on load, and keys typed into a field are not hotkeys.
    await page.locator("input:focus").blur();

    await expect(position).toBeHidden();
    await page.keyboard.press("`");
    await expect(position).toBeVisible();
    await page.keyboard.press("`");
    await expect(position).toBeHidden();
  });

  test("starts with the position readout on under ?debug", async ({ page }) => {
    await page.goto("/?debug");
    await expect(page.getByText("Position:")).toBeVisible();
  });
});
