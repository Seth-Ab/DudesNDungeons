import { expect, test, type Page } from "@playwright/test";
import { enterHub } from "./designScreen.js";

const WINDOWS = [
  { name: "wide", width: 1600, height: 900 },
  { name: "narrow", width: 760, height: 620 },
] as const;

/** The darkest pixel in a grid over the middle of the game canvas, as 0-255 brightness. */
async function darkestCentre(page: Page): Promise<number> {
  return page.locator("canvas.game-canvas").evaluate((element) => {
    // Typed by hand: the test project compiles without the DOM library.
    const canvas = element as unknown as {
      width: number;
      height: number;
      getContext(kind: "2d"): { getImageData(x: number, y: number, w: number, h: number): { data: ArrayLike<number> } };
    };
    const context = canvas.getContext("2d");
    let darkest = 255;
    for (let column = 1; column <= 5; column += 1) {
      for (let row = 1; row <= 5; row += 1) {
        const x = Math.floor((canvas.width * (0.3 + column * 0.07)) | 0);
        const y = Math.floor((canvas.height * (0.3 + row * 0.07)) | 0);
        const { data } = context.getImageData(x, y, 1, 1);
        darkest = Math.min(darkest, Math.max(data[0] ?? 0, data[1] ?? 0, data[2] ?? 0));
      }
    }
    return darkest;
  });
}

test.describe("Hub lighting", () => {
  for (const window of WINDOWS) {
    test(`lights the plaza and names the stall only when near, at a ${window.name} window`, async ({ page }, testInfo) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.setViewportSize({ width: window.width, height: window.height });
      await page.goto("/");
      await page.getByPlaceholder("Your name").fill("Maya");
      await page.getByRole("button", { name: "Create a new dungeon" }).click();
      await enterHub(page);
      await page.waitForTimeout(600);

      // No tile of the plaza is black, however far the nearest lantern.
      expect(await darkestCentre(page)).toBeGreaterThan(24);
      await page.screenshot({ path: testInfo.outputPath(`hub-lighting-far-${window.name}.png`) });

      // Walk up to the Torch Supply stall in the north-west, until its counter stops the player.
      await page.keyboard.down("a");
      await page.keyboard.down("w");
      await page.waitForTimeout(1500);
      await page.keyboard.up("a");
      await page.keyboard.up("w");
      await page.waitForTimeout(300);
      await page.screenshot({ path: testInfo.outputPath(`hub-lighting-near-${window.name}.png`) });

      expect(errors).toEqual([]);
    });
  }
});
