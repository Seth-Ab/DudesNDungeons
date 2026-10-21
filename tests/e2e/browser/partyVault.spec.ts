import { expect, test, type Browser, type Page } from "@playwright/test";
import { trackContexts } from "./contexts.js";
import { enterHub } from "./designScreen.js";
import { position, walkTo } from "./walk.js";

const track = trackContexts();

/** World position of the hub's Rusted Sword, on the Weapons counter: authored (15.125, 5.3125). */
const SWORD = { x: 62, y: 22.75 };
/** The open row north of the fountain, which joins every part of the plaza. */
const NORTH_ROAD_Y = 17.5;
/** Inside the Bank room (authored 5..7, 8..10), the hub's vault area, in front of the Bank stall. */
const AT_VAULT = { x: 21.5, y: 33.5 };
/** A second spot in the same room, so the guest does not walk into the host. */
const BESIDE_VAULT = { x: 25.5, y: 33.5 };

async function openPlayer(browser: Browser): Promise<Page> {
  const context = track(await browser.newContext({ viewport: { width: 1280, height: 720 } }));
  const page = await context.newPage();
  await page.goto("/?debug");
  return page;
}

/**
 * From either spawn beside the fountain up to the north road, along it, and down the open column
 * west of the Torch Supply into the Bank room. The fountain, its benches and the stalls stand in
 * every straighter line.
 */
async function walkToVault(page: Page, spot = AT_VAULT): Promise<void> {
  const start = await position(page);
  const column = start.x > 44 ? 57.5 : 33.5;
  for (const waypoint of [
    { x: column, y: start.y },
    { x: column, y: NORTH_ROAD_Y },
    { x: AT_VAULT.x, y: NORTH_ROAD_Y },
    // Into the row just north of the room, then across and down to the spot.
    { x: AT_VAULT.x, y: 29.5 },
    { x: spot.x, y: 29.5 },
    spot,
  ]) {
    await walkTo(page, waypoint, 0.6);
  }
}

async function openVault(page: Page) {
  await expect(page.locator(".hud__prompt", { hasText: "Open the party vault" })).toBeVisible();
  const panel = page.getByRole("dialog", { name: "Party Vault" });
  await expect(async () => {
    await page.keyboard.press("e");
    await expect(panel).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 10_000 });
  return panel;
}

test.describe("Party vault", () => {
  test("two players share one vault, and a withdrawal leaves the other's panel", async ({ browser }, testInfo) => {
    test.setTimeout(120_000);

    const host = await openPlayer(browser);
    await host.getByPlaceholder("Your name").fill("Maya");
    await host.getByRole("button", { name: "Create a new dungeon" }).click();
    const room = host.locator(".hud__stat", { hasText: "Room:" }).locator("span");
    await expect(room).toHaveText(/^[A-Z0-9]{6}$/);
    const roomCode = (await room.textContent()) ?? "";
    await enterHub(host);
    await expect(host.getByText("Position:")).toContainText(/\d+\.\d+, \d+\.\d+/);

    // Something to store: the Rusted Sword from the Weapons counter, as `hubSword.spec.ts` takes it.
    const start = await position(host);
    for (const waypoint of [
      { x: start.x > 44 ? 57.5 : 33.5, y: start.y },
      { x: start.x > 44 ? 57.5 : 33.5, y: NORTH_ROAD_Y },
      { x: 57.5, y: NORTH_ROAD_Y },
      { x: 57.5, y: 25.5 },
    ]) {
      await walkTo(host, waypoint, 0.6);
    }
    await walkTo(host, { x: SWORD.x, y: SWORD.y + 1.75 }, 0.3);
    await host.keyboard.down("w");
    await host.waitForTimeout(400);
    await host.keyboard.up("w");
    const handSlot = host.locator(".hud__slot--held");
    await expect(async () => {
      await host.keyboard.press("f");
      await expect(handSlot).toHaveAttribute("aria-label", /In hand \(V\): Rusted Sword/, { timeout: 1000 });
    }).toPass({ timeout: 10_000 });

    await walkTo(host, { x: 57.5, y: 25.5 }, 0.6);
    await walkToVault(host);
    const hostVault = await openVault(host);
    await expect(hostVault).toContainText("Nothing stored yet");
    await hostVault.getByRole("button", { name: "Store Rusted Sword" }).click();
    await expect(hostVault.getByRole("button", { name: "Take Rusted Sword" })).toBeVisible();
    await expect(handSlot).toHaveAttribute("aria-label", /Empty hand/);

    const guest = await openPlayer(browser);
    await guest.getByPlaceholder("Your name").fill("Sam");
    await guest.getByPlaceholder(/Room code/).fill(roomCode);
    await guest.getByRole("button", { name: "Join dungeon" }).click();
    await enterHub(guest);
    await expect(guest.getByText("Position:")).toContainText(/\d+\.\d+, \d+\.\d+/);
    await walkToVault(guest, BESIDE_VAULT);
    const guestVault = await openVault(guest);
    await expect(guestVault.getByRole("button", { name: "Take Rusted Sword" })).toBeVisible();
    await guest.screenshot({ path: testInfo.outputPath("party-vault-guest-sees-deposit.png") });

    await guestVault.getByRole("button", { name: "Take Rusted Sword" }).click();
    await expect(guest.locator(".hud__slot--held")).toHaveAttribute("aria-label", /In hand \(V\): Rusted Sword/);
    await expect(guestVault).toContainText("Nothing stored yet");
    // The host's panel is still open, and the server's next `partyVault` empties it there too.
    await expect(hostVault).toContainText("Nothing stored yet");
    await expect(hostVault.getByRole("button", { name: "Take Rusted Sword" })).toHaveCount(0);
    await host.screenshot({ path: testInfo.outputPath("party-vault-host-after-withdrawal.png") });

    // Walking out of the vault area shuts the panel.
    await walkTo(guest, { x: BESIDE_VAULT.x, y: 29.5 }, 0.6);
    await expect(guestVault).toBeHidden();
  });
});
