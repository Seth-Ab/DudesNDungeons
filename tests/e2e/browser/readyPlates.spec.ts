import { expect, test, type Browser, type Page } from "@playwright/test";
import { enterHub } from "./designScreen.js";

/**
 * The westmost ready plate, authored (9.5, 2) in `content/dungeons/hub.json`, and a spot on the
 * gate road behind the row of plates, well clear of all four.
 */
const WEST_PLATE = { x: 39.5, y: 9.5 };
const OFF_PLATES = { x: 39.5, y: 14 };

/**
 * The open column either side of the fountain and its benches, at authored x 8 and x 14, which a
 * player walks up from the spawns beside the fountain to reach the gate road.
 */
const WEST_COLUMN_X = 33.5;
const EAST_COLUMN_X = 57.5;

async function openPlayer(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  await page.goto("/?debug");
  return page;
}

async function position(page: Page): Promise<{ x: number; y: number }> {
  const text = (await page.getByText("Position:").textContent()) ?? "";
  const [x, y] = (text.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  if (x === undefined || y === undefined) throw new Error(`No position in "${text}"`);
  return { x, y };
}

/** Walks until the predicted position is within `reach` of `target`, steering by the readout. */
async function walkTo(page: Page, target: { x: number; y: number }, reach: number): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const at = await position(page);
    const dx = target.x - at.x;
    const dy = target.y - at.y;
    if (Math.hypot(dx, dy) <= reach) return;

    const key = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? "d" : "a") : dy > 0 ? "s" : "w";
    await page.keyboard.down(key);
    await page.waitForTimeout(Math.max(Math.abs(dx), Math.abs(dy)) > 2 ? 200 : 40);
    await page.keyboard.up(key);
  }
  throw new Error(`Never reached ${JSON.stringify(target)}`);
}

/** From a spawn beside the fountain round it on whichever side they stand, then behind the plates. */
async function walkToGateRoad(page: Page): Promise<void> {
  const start = await position(page);
  const column = start.x < 45.5 ? WEST_COLUMN_X : EAST_COLUMN_X;
  for (const waypoint of [{ x: column, y: start.y }, { x: column, y: OFF_PLATES.y }, OFF_PLATES]) {
    await walkTo(page, waypoint, 0.6);
  }
}

/** The named member's pip in the hub gate status, which marks them ready. */
const pip = (page: Page, name: string) => page.locator(`.hud__hub-pip[aria-label^="${name}:"]`);

test.describe("Hub ready plates", () => {
  test("stepping on a plate readies a player for both clients, and stepping off unreadies them", async ({
    browser,
  }, testInfo) => {
    test.setTimeout(120_000);
    const host = await openPlayer(browser);
    await host.getByPlaceholder("Your name").fill("Maya");
    await host.getByRole("button", { name: "Create a new dungeon" }).click();
    await enterHub(host);
    const room = host.locator(".hud__stat", { hasText: "Room:" }).locator("span");
    await expect(room).toHaveText(/^[A-Z0-9]{6}$/);
    const roomCode = (await room.textContent()) ?? "";

    const guest = await openPlayer(browser);
    await guest.getByPlaceholder("Your name").fill("Theo");
    await guest.getByPlaceholder(/Room code/).fill(roomCode);
    await guest.getByRole("button", { name: "Join dungeon" }).click();
    await enterHub(guest);
    await expect(host.locator(".hud__frames")).toContainText("Theo", { timeout: 15_000 });
    await expect(host.getByText("Position:")).toContainText(/\d+\.\d+, \d+\.\d+/);

    // Both walk up to the gate road, so the guest can watch the host's plate light.
    await walkToGateRoad(guest);
    await walkToGateRoad(host);
    await expect(pip(host, "Maya")).not.toHaveClass(/hud__hub-pip--ready/);

    await walkTo(host, WEST_PLATE, 0.6);
    for (const page of [host, guest]) {
      await expect(pip(page, "Maya")).toHaveClass(/hud__hub-pip--ready/, { timeout: 5_000 });
    }
    await host.screenshot({ path: testInfo.outputPath("plate-host-ready.png") });
    await guest.screenshot({ path: testInfo.outputPath("plate-guest-sees-host-ready.png") });

    await walkTo(host, OFF_PLATES, 0.6);
    for (const page of [host, guest]) {
      await expect(pip(page, "Maya")).not.toHaveClass(/hud__hub-pip--ready/, { timeout: 5_000 });
    }
    await guest.screenshot({ path: testInfo.outputPath("plate-guest-sees-host-stepped-off.png") });

    // Both on plates: the party is ready, and both screens get the cue.
    await walkTo(host, WEST_PLATE, 0.6);
    await walkTo(guest, { x: WEST_PLATE.x + 4, y: WEST_PLATE.y }, 0.6);
    for (const page of [host, guest]) {
      await expect(page.getByText("Everyone is ready. Head through the gate.")).toBeVisible({ timeout: 5_000 });
    }
    await host.screenshot({ path: testInfo.outputPath("plate-party-ready.png") });

    await host.context().close();
    await guest.context().close();
  });
});
