import { expect, test } from "@playwright/test";
import { campMenu, openCampMenu } from "./campMenu.js";
import { enterHub } from "./designScreen.js";

test.describe("HUD accessibility and layout", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");
    await page.getByPlaceholder("Your name").fill("Maya");
    await page.getByRole("button", { name: "Create a new dungeon" }).click();
    await enterHub(page);
    await expect(page.locator(".hud__vitals")).toBeVisible();
  });

  for (const size of [
    { name: "wide", width: 1280, height: 720 },
    { name: "narrow", width: 800, height: 600 },
  ]) {
    test(`renders every HUD cluster inside a ${size.name} viewport without covering the canvas centre`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      const viewport = page.viewportSize()!;
      for (const selector of [
        ".hud__panel--hints",
        ".hud__panel--session",
        ".hud__panel--party",
        // The bottom-right actions panel is touch-only in the hub; touchControls.spec.ts places it.
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

      // The key hints sit above the party frames, not over them.
      const hints = (await page.locator(".hud__panel--hints").boundingBox())!;
      const frames = await page.locator(".hud__frames").boundingBox();
      if (frames) expect(hints.y + hints.height).toBeLessThanOrEqual(frames.y);
      // Nor under the toast stack beside them.
      const toasts = await page.locator(".hud__toasts").boundingBox();
      if (toasts) expect(hints.x + hints.width).toBeLessThanOrEqual(toasts.x);

      // A trial click fails if an overlay intercepts the pointer at the canvas centre.
      await page.locator("canvas.game-canvas").click({
        position: { x: viewport.width / 2, y: viewport.height / 2 },
        trial: true,
      });
      await page.screenshot({ path: testInfo.outputPath(`hud-${size.name}.png`) });

      await openCampMenu(page);
      await page.screenshot({ path: testInfo.outputPath(`camp-menu-${size.name}.png`) });
    });
  }

  test("keeps the session and voice controls off screen until the camp menu opens", async ({ page }) => {
    for (const name of ["Leave", "Controls", "Stash", "Enable Voice", "Mute", "Deafen"]) {
      await expect(page.getByRole("button", { name, exact: true }), name).toHaveCount(0);
    }
    // In the hub, Ready stays on screen for new players, and the mic chip stays for everyone.
    await expect(page.getByRole("button", { name: "Ready", exact: true })).toHaveCount(1);
    await expect(page.locator(".hud__hub-ready")).toBeVisible();
    await expect(page.locator(".hud__mic")).toHaveText("Mic off");

    // The title, Place, and Action lines are gone; the debug key still shows the position.
    await expect(page.getByText("DudesNDungeons", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Place:")).toHaveCount(0);
    await expect(page.getByText("Action:")).toHaveCount(0);
    await expect(page.getByText("Position:")).toBeHidden();
    await page.keyboard.press("`");
    await expect(page.getByText("Position:")).toBeVisible();

    const camp = await openCampMenu(page);
    for (const name of ["Ready", "Leave", "Stash", "Controls", "Enable Voice", "Mute", "Deafen"]) {
      await expect(camp.getByRole("button", { name, exact: true }), name).toBeVisible();
    }
    // Voice keeps its disabled rules: there is nothing to mute until voice is live.
    await expect(camp.getByRole("button", { name: "Mute" })).toBeDisabled();
    await expect(camp.getByRole("button", { name: "Enable Voice" })).toBeEnabled();
  });

  test("Escape opens and closes the camp menu, traps focus, and hands focus back", async ({ page }) => {
    const opener = page.getByRole("button", { name: "Open the camp menu (Esc)" });
    await opener.focus();
    const camp = await openCampMenu(page);
    await expect(camp.locator(":focus")).toHaveCount(1);

    // Tab and Shift+Tab never leave the dialog.
    for (let step = 0; step < 12; step += 1) {
      await page.keyboard.press(step < 6 ? "Tab" : "Shift+Tab");
      await expect(camp.locator(":focus")).toHaveCount(1);
    }

    await page.keyboard.press("Escape");
    await expect(camp).toBeHidden();
    await expect(opener).toBeFocused();

    // The Close button, and the hint button for players with no Escape key.
    await opener.click();
    await expect(camp).toBeVisible();
    await camp.getByRole("button", { name: "Close" }).click();
    await expect(camp).toBeHidden();
  });

  test("Escape closes the controls menu and the emote wheel without opening the camp menu", async ({ page }) => {
    await (await openCampMenu(page)).getByRole("button", { name: "Controls" }).click();
    const controls = page.getByRole("dialog", { name: "Controls" });
    await expect(controls).toBeVisible();
    await expect(campMenu(page)).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(controls).toBeHidden();
    await expect(campMenu(page)).toBeHidden();

    const wheel = page.getByRole("dialog", { name: "Emotes" });
    await page.keyboard.press("b");
    await expect(wheel).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(wheel).toBeHidden();
    await expect(campMenu(page)).toBeHidden();

    // The next press is free for the camp menu again.
    await openCampMenu(page);
  });

  test("vitals are told apart by glyph, not colour alone", async ({ page }) => {
    const glyphs = await page.locator(".hud__vitals .hud__bar-label").allTextContents();
    expect(new Set(glyphs).size).toBe(glyphs.length);
  });

  test("reduced motion and UI scale apply and persist across a reload", async ({ page }) => {
    await (await openCampMenu(page)).getByRole("button", { name: "Controls" }).click();
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
