import { expect, test, type Browser, type Page } from "@playwright/test";
import { openCampMenu } from "./campMenu.js";
import { enterHub } from "./designScreen.js";

/**
 * Two real browsers in one party, in the lit hub where they can see each other. The host drives
 * the wheel by keyboard, the guest by touch, and each sees the other's emote in the action feed.
 */
async function openPlayer(browser: Browser, hasTouch: boolean): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, hasTouch });
  const page = await context.newPage();
  await page.goto("/");
  return page;
}

// The latest action, said as a toast.
const actionFeed = (page: Page) => page.locator(".hud__toasts");
const wheel = (page: Page) => page.getByRole("dialog", { name: "Emotes" });

test.describe("Emote wheel", () => {
  test("two players emote by keyboard and by touch, and each sees the other's", async ({ browser }, testInfo) => {
    const host = await openPlayer(browser, false);
    await host.getByPlaceholder("Your name").fill("Maya");
    await host.getByRole("button", { name: "Create a new dungeon" }).click();
    await enterHub(host);
    const room = host.locator(".hud__stat", { hasText: "Room:" }).locator("span");
    await expect(room).toHaveText(/^[A-Z0-9]{6}$/);
    const roomCode = (await room.textContent()) ?? "";

    const guest = await openPlayer(browser, true);
    await guest.getByPlaceholder("Your name").fill("Theo");
    await guest.getByPlaceholder(/Room code/).fill(roomCode);
    await guest.getByRole("button", { name: "Join dungeon" }).click();
    await enterHub(guest);
    await expect(guest.locator(".hud__vitals")).toBeVisible();
    await expect(host.locator(".hud__frames")).toContainText("Theo", { timeout: 15_000 });

    // Keyboard: the wheel opens on its key with focus on the first option, drawn with a ring.
    await host.keyboard.press("b");
    await expect(wheel(host)).toBeVisible();
    const wave = host.getByRole("button", { name: "Wave", exact: true });
    await expect(wave).toBeFocused();
    await host.keyboard.press("ArrowRight");
    const cheer = host.getByRole("button", { name: "Cheer", exact: true });
    await expect(cheer).toBeFocused();
    await expect(cheer).not.toHaveCSS("box-shadow", "none");
    await host.screenshot({ path: testInfo.outputPath("emote-wheel-open.png") });
    // While open, a number picks an emote rather than using an inventory slot.
    await host.keyboard.press("1");
    await expect(wheel(host)).toBeHidden();
    await expect(actionFeed(host)).toContainText("You: Wave");
    await expect(actionFeed(guest)).toContainText("Maya waves.");
    await guest.screenshot({ path: testInfo.outputPath("emote-guest-sees-wave.png") });

    // Touch: the HUD's Emote button opens the wheel, and a tap picks.
    await guest.getByRole("button", { name: "Emote", exact: true }).tap();
    await expect(wheel(guest)).toBeVisible();
    await guest.getByRole("button", { name: "Follow me", exact: true }).tap();
    await expect(wheel(guest)).toBeHidden();
    await expect(actionFeed(host)).toContainText("Theo says follow me.");
    await host.screenshot({ path: testInfo.outputPath("emote-host-sees-follow-me.png") });

    // Escape and the wheel key both close it without sending anything.
    await host.keyboard.press("b");
    await expect(wheel(host)).toBeVisible();
    await host.keyboard.press("Escape");
    await expect(wheel(host)).toBeHidden();
    await host.keyboard.press("b");
    await expect(wheel(host)).toBeVisible();
    await host.keyboard.press("b");
    await expect(wheel(host)).toBeHidden();
    await expect(actionFeed(host)).toContainText("Theo says follow me.");

    // Left open, two live game pages keep rendering and slow whichever spec this worker runs next.
    await host.context().close();
    await guest.context().close();
  });

  test("the wheel key is listed in the controls menu and can be rebound", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/");
    await page.getByPlaceholder("Your name").fill("Maya");
    await page.getByRole("button", { name: "Create a new dungeon" }).click();
    await enterHub(page);
    await expect(page.locator(".hud__vitals")).toBeVisible();

    const camp = await openCampMenu(page);
    await camp.getByRole("button", { name: "Controls" }).click();
    await expect(camp).toBeHidden();
    await page.getByRole("button", { name: "Emote wheel: B" }).click();
    await page.keyboard.press("k");
    await expect(page.getByRole("button", { name: "Emote wheel: K" })).toBeVisible();
    await page.getByRole("button", { name: "Close" }).click();

    await page.keyboard.press("b");
    await expect(wheel(page)).toBeHidden();
    await page.keyboard.press("k");
    await expect(wheel(page)).toBeVisible();
    // A mouse click picks too.
    await page.getByRole("button", { name: "Bow", exact: true }).click();
    await expect(wheel(page)).toBeHidden();
    await expect(actionFeed(page)).toContainText("You: Bow");
  });
});
