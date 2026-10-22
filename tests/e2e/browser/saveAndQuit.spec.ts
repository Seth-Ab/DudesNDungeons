import { expect, test, type Page } from "@playwright/test";
import { campMenu, openCampMenu } from "./campMenu.js";
import { trackContexts } from "./contexts.js";
import { enterHub } from "./designScreen.js";
import { position, walkTo } from "./walk.js";

const TORCH = { x: 25.5, y: 22.75 };
const GATE = { x: 45.5, y: 5.5 };
const TO_TORCHES = [
  { x: 33.5, y: 29.5 },
  { x: 33.5, y: 25.5 },
];
const TO_GATE = [
  { x: 33.5, y: 25.5 },
  { x: 33.5, y: 17.5 },
  { x: 45.5, y: 17.5 },
];

/** The host takes a torch to the gate while the guest readies; the party walks into the dungeon. */
async function startRun(host: Page, guest: Page): Promise<void> {
  for (const waypoint of TO_TORCHES) await walkTo(host, waypoint, 0.6);
  await walkTo(host, { x: TORCH.x, y: TORCH.y + 1.75 }, 0.3);
  await host.keyboard.down("w");
  await host.waitForTimeout(400);
  await host.keyboard.up("w");
  await host.keyboard.press("f");
  await host.getByRole("button", { name: "Ready" }).click();
  await guest.getByRole("button", { name: "Ready" }).click();
  for (const waypoint of TO_GATE) await walkTo(host, waypoint, 0.6);
  await walkTo(host, GATE, 1);
  await expect(async () => {
    await host.keyboard.press("e");
    await expect(host.locator(".hud__tally")).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
}

const track = trackContexts();

test.describe("Save and quit", () => {
  test("saves a run, asks before restoring it, keeps it through a cancelled Start fresh, and continues in place", async ({
    browser,
  }, testInfo) => {
    test.setTimeout(180_000);
    const context = track(await browser.newContext({ viewport: { width: 1280, height: 720 } }));
    const guestContext = track(await browser.newContext({ viewport: { width: 1280, height: 720 } }));
    {
      const host = await context.newPage();
      await host.goto("/?debug");
      await host.getByPlaceholder("Your name").fill("Maya");
      await host.getByRole("button", { name: "Create a new dungeon" }).click();
      const room = host.locator(".hud__stat", { hasText: "Room:" }).locator("span");
      await expect(room).toHaveText(/^[A-Z0-9]{6}$/);
      const roomCode = (await room.textContent()) ?? "";
      await enterHub(host);

      const guest = await guestContext.newPage();
      await guest.goto("/?debug");
      await guest.getByPlaceholder("Your name").fill("Sam");
      await guest.getByPlaceholder(/Room code/).fill(roomCode);
      await guest.getByRole("button", { name: "Join dungeon" }).click();
      await enterHub(guest);

      // The hub has no run to save.
      const saveAndQuit = (page: Page) => campMenu(page).getByRole("button", { name: "Save and quit" });
      await openCampMenu(guest);
      await expect(saveAndQuit(guest)).toBeHidden();
      await guest.keyboard.press("Escape");

      await startRun(host, guest);
      await expect(guest.locator(".hud__tally")).toBeVisible();
      const savedAt = await position(guest);

      // Guest saves and quits: back in the lobby with the room code filled in; the host sees them go.
      await openCampMenu(guest);
      await expect(saveAndQuit(guest)).toBeVisible();
      await guest.screenshot({ path: testInfo.outputPath("camp-menu-save-and-quit.png") });
      await saveAndQuit(guest).click();
      const lobby = guest.locator(".lobby");
      await expect(lobby).toBeVisible();
      await expect(guest.getByPlaceholder(/Room code/)).toHaveValue(roomCode);
      await expect(host.locator(".hud__frame", { hasText: "Sam" })).toHaveCount(0);

      // Rejoining a saved room asks first.
      await guest.getByRole("button", { name: "Join dungeon" }).click();
      const prompt = lobby.getByRole("group", { name: "This room has a saved run" });
      await expect(prompt).toBeVisible();
      await guest.screenshot({ path: testInfo.outputPath("saved-room-prompt.png") });

      // Start fresh needs a second confirmation, and cancelling it keeps the save.
      await prompt.getByRole("button", { name: "Start fresh" }).click();
      const confirm = lobby.getByRole("group", { name: "Delete the saved run?" });
      await expect(confirm).toContainText("The party vault is kept");
      await guest.screenshot({ path: testInfo.outputPath("start-fresh-confirmation.png") });
      await confirm.getByRole("button", { name: "Cancel" }).click();
      await expect(prompt).toBeVisible();

      await prompt.getByRole("button", { name: "Continue" }).click();
      await expect(lobby).toBeHidden();
      await expect(guest.locator(".hud__tally")).toBeVisible();
      const resumed = await position(guest);
      expect(Math.hypot(resumed.x - savedAt.x, resumed.y - savedAt.y)).toBeLessThan(1);
      await expect(host.locator(".hud__frame", { hasText: "Sam" })).toBeVisible();
      await guest.screenshot({ path: testInfo.outputPath("continued-run.png") });
    }
  });
});
