import { expect, test, type Browser, type Page } from "@playwright/test";
import { enterHub } from "./designScreen.js";
import { position, walkTo } from "./walk.js";

/**
 * The fountain rim's west seat, authored (9.5625, 7) in `content/dungeons/hub.json`, and the floor
 * in front of it, one step west of the first spawn.
 */
const WEST_RIM = { x: 39.75, y: 29.5 };
const IN_FRONT = { x: 39, y: 29.5 };

async function openPlayer(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  await page.goto("/?debug");
  return page;
}

const sitPrompt = (page: Page) => page.locator(".hud__prompt", { hasText: "Sit" });

test.describe("Hub seats", () => {
  test("a player sits on the fountain rim, and a step stands them back up", async ({ browser }, testInfo) => {
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

    await walkTo(host, IN_FRONT, 0.3);
    await expect(sitPrompt(host)).toBeVisible();

    // The prompt names the seat; the server moves the player onto the rim, facing out.
    await expect(async () => {
      await host.keyboard.press("e");
      await expect(host.getByText("Position:")).toContainText(`${WEST_RIM.x.toFixed(2)}, ${WEST_RIM.y.toFixed(2)}`, {
        timeout: 1000,
      });
    }).toPass({ timeout: 10_000 });
    await expect(sitPrompt(host)).toBeHidden();
    await host.screenshot({ path: testInfo.outputPath("seat-host-seated.png") });
    await guest.screenshot({ path: testInfo.outputPath("seat-guest-sees-host-seated.png") });

    // A step into the fountain stands them up on the floor in front of it, not through it.
    await host.keyboard.down("d");
    await host.waitForTimeout(150);
    await host.keyboard.up("d");
    await expect.poll(async () => (await position(host)).x).toBeLessThan(39.5);
    await expect(sitPrompt(host)).toBeVisible();
    await host.screenshot({ path: testInfo.outputPath("seat-host-stood.png") });
    await guest.screenshot({ path: testInfo.outputPath("seat-guest-sees-host-stood.png") });

    await host.context().close();
    await guest.context().close();
  });
});
