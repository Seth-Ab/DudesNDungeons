import { expect, test } from "@playwright/test";
import { openCampMenu } from "./campMenu.js";
import { enterHub } from "./designScreen.js";

// Page scripts are strings because the test project compiles without the DOM library.
const READ_FRAME = `(selector) => {
  const element = document.querySelector(selector);
  if (!element) return null;
  const style = getComputedStyle(element);
  return {
    source: style.borderImageSource,
    width: style.borderTopWidth,
    radius: style.borderTopLeftRadius,
    rendering: style.imageRendering,
    zoom: getComputedStyle(document.documentElement).getPropertyValue("--hud-zoom").trim(),
  };
}`;

interface FrameStyle {
  source: string;
  width: string;
  radius: string;
  rendering: string;
  zoom: string;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

const SCALES = [
  { name: "default", uiScale: 1, zoom: 2 },
  { name: "largest", uiScale: 1.3, zoom: 3 },
] as const;

for (const { name, uiScale, zoom } of SCALES) {
  test.describe(`HUD frame at the ${name} UI scale`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript(
        `window.localStorage.setItem("dnd.hudSettings", ${JSON.stringify(
          JSON.stringify({ reducedMotion: true, uiScale }),
        )})`,
      );
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto("/");
      await page.getByPlaceholder("Your name").fill("Maya");
      await page.getByRole("button", { name: "Create a new dungeon" }).click();
      await enterHub(page);
      await expect(page.locator(".hud__vitals")).toBeVisible();
    });

    test("every HUD panel wears the pixelated 9-slice frame at a whole-number zoom", async ({ page }, testInfo) => {
      const panels = [
        ".hud__panel--hints",
        ".hud__panel--session",
        ".hud__panel--party",
        ".hud__minimap",
        ".hud__slot",
        ".hud__hub-status",
      ];

      for (const selector of panels) {
        const frame = await page.evaluate<FrameStyle | null>(`(${READ_FRAME})(${JSON.stringify(selector)})`);
        expect(frame, selector).not.toBeNull();
        expect(frame!.source, selector).toContain("hud-frame");
        expect(frame!.zoom, selector).toBe(String(zoom));
        expect(frame!.width, selector).toBe(`${4 * zoom}px`);
        expect(frame!.radius, selector).toBe("0px");
        expect(frame!.rendering, selector).toBe("pixelated");
      }

      // The camp menu and the stash are the other two surfaces a player opens.
      const camp = await openCampMenu(page);
      const campFrame = await page.evaluate<FrameStyle | null>(
        `(${READ_FRAME})(".camp-menu__panel")`,
      );
      expect(campFrame!.source).toContain("hud-frame");
      await page.screenshot({ path: testInfo.outputPath(`camp-menu-${name}.png`) });
      await camp.getByRole("button", { name: "Stash" }).click();
      await expect(page.locator(".hud__stash")).toBeVisible();
      const stashFrame = await page.evaluate<FrameStyle | null>(`(${READ_FRAME})(".hud__stash")`);
      expect(stashFrame!.source).toContain("hud-frame");
      await page.screenshot({ path: testInfo.outputPath(`stash-${name}.png`) });
    });

    test("no frame is clipped by the viewport or overlaps another panel", async ({ page }, testInfo) => {
      const viewport = page.viewportSize()!;
      const selectors = [
        ".hud__panel--hints",
        ".hud__panel--session",
        ".hud__panel--party",
        ".hud__minimap",
        ".hud__frames",
        ".hud__hotbar",
        ".hud__hub-status",
      ];

      await page.screenshot({ path: testInfo.outputPath(`hud-${name}.png`) });

      const boxes: { selector: string; box: Box }[] = [];
      for (const selector of selectors) {
        const locator = page.locator(selector).first();
        if (!(await locator.isVisible())) continue;
        const box = (await locator.boundingBox())!;
        expect(box.x, selector).toBeGreaterThanOrEqual(0);
        expect(box.y, selector).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, selector).toBeLessThanOrEqual(viewport.width);
        expect(box.y + box.height, selector).toBeLessThanOrEqual(viewport.height);
        boxes.push({ selector, box });
      }
      expect(boxes.length).toBeGreaterThanOrEqual(4);

      for (const [index, a] of boxes.entries()) {
        for (const b of boxes.slice(index + 1)) {
          expect(overlaps(a.box, b.box), `${a.selector} overlaps ${b.selector}`).toBe(false);
        }
      }
    });
  });
}
