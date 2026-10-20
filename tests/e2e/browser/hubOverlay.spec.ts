import { expect, test, type Locator } from "@playwright/test";
import { campMenu, openCampMenu } from "./campMenu.js";
import { enterHub } from "./designScreen.js";

async function box(locator: Locator) {
  const rect = await locator.boundingBox();
  if (!rect) throw new Error("element has no box");
  return rect;
}

function overlaps(a: { x: number; y: number; width: number; height: number }, b: typeof a): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

test.describe("Hub overlay", () => {
  test("shows the gate status and a stash opened from the camp menu, with no run clock", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");
    await page.getByPlaceholder("Your name").fill("Maya");
    await page.getByRole("button", { name: "Create a new dungeon" }).click();
    await enterHub(page);

    const status = page.locator(".hud__hub-status");
    await expect(status).toBeVisible();
    await expect(status).toContainText("Waiting on Maya");
    await expect(page.locator(".hud__clock")).toBeHidden();

    const stash = page.locator(".hud__stash");
    await expect(stash).toBeHidden();
    await (await openCampMenu(page)).getByRole("button", { name: "Stash" }).click();
    await expect(campMenu(page)).toBeHidden();
    await expect(stash).toBeVisible();
    await expect(stash).toContainText("Nothing banked yet");
    await page.screenshot({ path: testInfo.outputPath("hub-overlay.png") });

    // Escape shuts the stash rather than opening the camp menu over it.
    await page.keyboard.press("Escape");
    await expect(stash).toBeHidden();
    await expect(campMenu(page)).toBeHidden();

    // The hub keeps an on-screen Ready button for new players.
    await page.getByRole("button", { name: "Ready" }).click();
    await expect(status).toContainText("Party ready");
  });

  test("stacks the gate banner and toasts in one column clear of the minimap and party frames", async ({ browser }, testInfo) => {
    const hostContext = await browser.newContext();
    const guestContext = await browser.newContext();
    const host = await hostContext.newPage();
    const guest = await guestContext.newPage();

    await host.setViewportSize({ width: 1280, height: 720 });
    await host.goto("/");
    await host.getByPlaceholder("Your name").fill("Maya");
    await host.getByRole("button", { name: "Create a new dungeon" }).click();
    await enterHub(host);
    const code = await host.locator(".hud__panel--session").innerText();
    const roomCode = /[A-Z0-9]{4,8}/.exec(code.replace(/Room:?/i, ""))?.[0];
    expect(roomCode).toBeTruthy();

    await guest.goto("/");
    await guest.getByPlaceholder("Your name").fill("Noor");
    await guest.getByPlaceholder(/room/i).fill(roomCode ?? "");
    await guest.getByRole("button", { name: /join/i }).click();
    await expect(host.locator(".hud__frame")).toHaveCount(1);

    const notices = host.locator(".hud__notices");
    const status = notices.locator(".hud__hub-status");
    const pips = status.locator(".hud__hub-pip");
    await expect(pips).toHaveCount(2);
    // Noor is still on the design screen: hollow pip, named as what the gate waits on.
    await expect(status).toContainText("Waiting on Noor to finish designing a character.");
    await expect(pips.nth(1)).toHaveAttribute("aria-label", "Noor: designing a character");
    await expect(status.locator("kbd")).toHaveText("E");

    // Toasts join the same column under the banner rather than a second stack over it.
    await host.keyboard.press("f");
    const toast = notices.locator(".hud__toasts .hud__toast").first();
    await expect(toast).toBeVisible();
    expect((await box(toast)).y).toBeGreaterThanOrEqual((await box(status)).y + (await box(status)).height);

    await enterHub(guest);
    await guest.getByRole("button", { name: "Ready" }).click();
    await expect(pips.nth(1)).toHaveText("✓");
    await expect(pips.nth(0)).toHaveText("○");

    for (const size of [
      { name: "wide", width: 1280, height: 720 },
      { name: "narrow", width: 800, height: 600 },
    ]) {
      await host.setViewportSize(size);
      const stack = await box(notices);
      for (const other of [".hud__minimap", ".hud__frames", ".hud__panel--hints", ".hud__panel--session"]) {
        const target = host.locator(other).first();
        if (!(await target.isVisible())) continue;
        expect(overlaps(stack, await box(target)), `${other} at ${size.name}`).toBe(false);
      }
      await host.screenshot({ path: testInfo.outputPath(`notice-stack-${size.name}.png`) });
    }

    await hostContext.close();
    await guestContext.close();
  });
});
