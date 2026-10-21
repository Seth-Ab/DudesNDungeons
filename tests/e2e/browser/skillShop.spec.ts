import { expect, test, type Browser, type Page } from "@playwright/test";
import { trackContexts } from "./contexts.js";
import { enterHub } from "./designScreen.js";
import { position, walkTo } from "./walk.js";

const track = trackContexts();

/** The open row north of the fountain, which joins every part of the plaza. */
const NORTH_ROAD_Y = 17.5;
/** In front of the Scrolls stall, inside the shop room (authored 4..8, 1..3): world x 16..36, y 4..16. */
const AT_SHOP = { x: 22.5, y: 13.5 };
/** A second spot in the same room, so the guest does not walk into the host. */
const BESIDE_SHOP = { x: 26.5, y: 13.5 };

async function openPlayer(browser: Browser): Promise<Page> {
  const context = track(await browser.newContext({ viewport: { width: 1280, height: 720 } }));
  const page = await context.newPage();
  await page.goto("/?debug");
  return page;
}

/**
 * From either spawn beside the fountain up to the north road, west along it, and up into the room
 * north of the Torch Supply. The fountain, its benches and the stalls stand in every straighter line.
 */
async function walkToShop(page: Page, spot = AT_SHOP): Promise<void> {
  const start = await position(page);
  const column = start.x > 44 ? 57.5 : 33.5;
  for (const waypoint of [
    { x: column, y: start.y },
    { x: column, y: NORTH_ROAD_Y },
    { x: spot.x, y: NORTH_ROAD_Y },
    spot,
  ]) {
    await walkTo(page, waypoint, 0.6);
  }
}

async function openShop(page: Page) {
  await expect(page.locator(".hud__prompt", { hasText: "Browse the scroll shop" })).toBeVisible();
  const panel = page.getByRole("dialog", { name: "Scroll shop" });
  await expect(async () => {
    await page.keyboard.press("e");
    await expect(panel).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 10_000 });
  return panel;
}

test.describe("Hub skill shop", () => {
  test("two players see the same stock, and an unaffordable purchase is refused inline", async ({ browser }, testInfo) => {
    test.setTimeout(120_000);

    const host = await openPlayer(browser);
    await host.getByPlaceholder("Your name").fill("Maya");
    await host.getByRole("button", { name: "Create a new dungeon" }).click();
    const room = host.locator(".hud__stat", { hasText: "Room:" }).locator("span");
    await expect(room).toHaveText(/^[A-Z0-9]{6}$/);
    const roomCode = (await room.textContent()) ?? "";
    await enterHub(host);
    await expect(host.getByText("Position:")).toContainText(/\d+\.\d+, \d+\.\d+/);
    await walkToShop(host);

    const hostShop = await openShop(host);
    await expect(hostShop).toContainText("Scroll of Iron Will - 20 coin");
    await expect(hostShop).toContainText("Your coin: 0");
    // Fixed stock plus the rotation: one more scroll, marked as rotating.
    await expect(hostShop.locator(".hud__shop-entry")).toHaveCount(2);
    await expect(hostShop).toContainText("Rotating stock");
    const hostStock = await hostShop.locator(".hud__shop-entry").allTextContents();

    const guest = await openPlayer(browser);
    await guest.getByPlaceholder("Your name").fill("Sam");
    await guest.getByPlaceholder(/Room code/).fill(roomCode);
    await guest.getByRole("button", { name: "Join dungeon" }).click();
    await enterHub(guest);
    await expect(guest.getByText("Position:")).toContainText(/\d+\.\d+, \d+\.\d+/);
    await walkToShop(guest, BESIDE_SHOP);

    const guestShop = await openShop(guest);
    expect(await guestShop.locator(".hud__shop-entry").allTextContents()).toEqual(hostStock);

    // A new profile has no coin, so the server refuses and the panel says why, without moving anything.
    await guestShop.getByRole("button", { name: "Buy Scroll of Iron Will for 20 coin" }).click();
    await expect(guestShop.locator(".hud__shop-notice")).toHaveText("Not enough coin.");
    await expect(guestShop).toContainText("Your coin: 0");
    await expect(guest.locator(".hud__slot", { hasText: "Scroll of Iron Will" })).toHaveCount(0);
    await guest.screenshot({ path: testInfo.outputPath("skill-shop-panel.png") });

    // Walking out of the shop room shuts the panel.
    await walkTo(guest, { x: BESIDE_SHOP.x, y: NORTH_ROAD_Y }, 0.6);
    await expect(guestShop).toBeHidden();
  });
});
