import { expect, test, type Browser, type Page } from "@playwright/test";
import { enterHub } from "./designScreen.js";

/**
 * The Attack and Emote buttons are for touch players only; a keyboard and mouse player has the
 * bound keys, which the hotbar and prompt keep showing.
 */
async function openPlayer(browser: Browser, hasTouch: boolean): Promise<{ page: Page; sent: string[] }> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, hasTouch });
  const page = await context.newPage();
  // What the client sends the server, so a tap can be shown to reach it.
  const sent: string[] = [];
  page.on("websocket", (socket) => socket.on("framesent", ({ payload }) => sent.push(String(payload))));
  await page.goto("/");
  await page.getByPlaceholder("Your name").fill("Maya");
  await page.getByRole("button", { name: "Create a new dungeon" }).click();
  await enterHub(page);
  await expect(page.locator(".hud__vitals")).toBeVisible();
  return { page, sent };
}

const attack = (page: Page) => page.getByRole("button", { name: "Attack", exact: true });
const emote = (page: Page) => page.getByRole("button", { name: "Emote", exact: true });
const coarsePointer = (page: Page) => page.evaluate<boolean>(`window.matchMedia("(pointer: coarse)").matches`);

test.describe("Touch-only action buttons", () => {
  test("a fine pointer gets neither button, in view or in the tab order", async ({ browser }, testInfo) => {
    const { page } = await openPlayer(browser, false);
    expect(await coarsePointer(page)).toBe(false);

    await expect(attack(page)).toBeHidden();
    await expect(emote(page)).toBeHidden();
    // In the hub there is no run clock either, so the bottom-right panel goes with them.
    await expect(page.locator(".hud__panel--actions")).toBeHidden();
    // The bound keys stay discoverable on the hotbar.
    await expect(page.locator(".hud__hotbar .hud__slot-key").first()).not.toBeEmpty();

    // Walk the whole tab order once: neither button ever takes focus.
    const focused: string[] = [];
    for (let i = 0; i < 40; i += 1) {
      await page.keyboard.press("Tab");
      focused.push(await page.evaluate<string>(`document.activeElement?.textContent?.trim() ?? ""`));
    }
    expect(focused).not.toContain("Attack");
    expect(focused).not.toContain("Emote");

    await page.screenshot({ path: testInfo.outputPath("touch-controls-desktop.png") });
    await page.context().close();
  });

  test("a coarse pointer gets both, and they work", async ({ browser }, testInfo) => {
    const { page, sent } = await openPlayer(browser, true);
    expect(await coarsePointer(page)).toBe(true);

    await expect(attack(page)).toBeVisible();
    await expect(emote(page)).toBeVisible();
    const viewport = page.viewportSize()!;
    const box = (await page.locator(".hud__panel--actions").boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);

    await page.screenshot({ path: testInfo.outputPath("touch-controls-touch.png") });

    await attack(page).tap();
    await expect.poll(() => sent.some((frame) => frame.includes('"playerAttack"'))).toBe(true);

    await emote(page).tap();
    const wheel = page.getByRole("dialog", { name: "Emotes" });
    await expect(wheel).toBeVisible();
    await page.getByRole("button", { name: "Wave", exact: true }).tap();
    await expect(wheel).toBeHidden();
    await expect(page.locator(".hud__toasts")).toContainText("You: Wave");

    await page.context().close();
  });

  test("a hybrid device switching its pointer shows and hides them live", async ({ browser }) => {
    const { page } = await openPlayer(browser, false);
    await expect(attack(page)).toBeHidden();

    // Chromium's touch emulation flips `(pointer: coarse)` without a reload, as a detached keyboard would.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
    await expect(attack(page)).toBeVisible();
    await expect(emote(page)).toBeVisible();

    await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
    await expect(attack(page)).toBeHidden();
    await expect(emote(page)).toBeHidden();
    await expect(page.locator(".hud__panel--actions")).toBeHidden();

    await page.context().close();
  });
});
