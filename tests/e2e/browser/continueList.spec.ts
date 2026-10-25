import { expect, test, type Page } from "@playwright/test";
import { campMenu, openCampMenu } from "./campMenu.js";
import { trackContexts } from "./contexts.js";
import { enterHub } from "./designScreen.js";
import { walkTo } from "./walk.js";

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

test.describe("The lobby's Continue list", () => {
  test("lists a saved run on a card for each member, and continues it with no design screen", async ({
    browser,
  }, testInfo) => {
    test.setTimeout(180_000);
    const host = await track(await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    const guest = await track(await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();

    await host.goto("/?debug");
    await host.getByPlaceholder("Your name").fill("Maya");
    await host.getByRole("button", { name: "Create a new dungeon" }).click();
    const room = host.locator(".hud__stat", { hasText: "Room:" }).locator("span");
    await expect(room).toHaveText(/^[A-Z0-9]{6}$/);
    const roomCode = (await room.textContent()) ?? "";
    await enterHub(host);

    await guest.goto("/?debug");
    await guest.getByPlaceholder("Your name").fill("Sam");
    await guest.getByPlaceholder(/Room code/).fill(roomCode);
    await guest.getByRole("button", { name: "Join dungeon" }).click();
    await enterHub(guest);

    await startRun(host, guest);
    await expect(guest.locator(".hud__tally")).toBeVisible();

    for (const page of [guest, host]) {
      await openCampMenu(page);
      await campMenu(page).getByRole("button", { name: "Save and quit" }).click();
      await expect(page.locator(".lobby")).toBeVisible();
    }

    // Each member's lobby offers the run on a card naming their own character first.
    const card = (page: Page) => page.locator(".lobby__card").filter({ hasText: roomCode });
    for (const [page, name, mate] of [
      [host, "Maya", "Sam"],
      [guest, "Sam", "Maya"],
    ] as const) {
      await expect(card(page)).toHaveCount(1);
      await expect(card(page)).toContainText(name);
      await expect(card(page)).toContainText(`Room ${roomCode}`);
      await expect(card(page)).toContainText("Vault");
      await expect(card(page).locator(".lobby__portrait")).toHaveAttribute("aria-label", name);
      await expect(card(page).locator(".lobby__head")).toHaveAttribute("aria-label", mate);
    }
    await guest.screenshot({ path: testInfo.outputPath("continue-list.png") });

    // The portrait is painted from the sheet, not left blank.
    // The server config has no DOM lib, so the canvas is typed by the few members read here.
    type PaintedCanvas = {
      width: number;
      height: number;
      getContext(id: "2d"): { getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray } } | null;
    };
    const painted = await card(guest)
      .locator(".lobby__portrait")
      .evaluate((canvas: PaintedCanvas) =>
        canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data.some((byte: number, index: number) => index % 4 === 3 && byte > 0),
      );
    expect(painted).toBe(true);

    // Continue goes straight into the run: no design screen, and the teammate is still there.
    await card(guest).getByRole("button", { name: "Continue" }).click();
    await expect(guest.locator(".lobby")).toBeHidden();
    await expect(guest.locator(".design")).toBeHidden();
    await expect(guest.locator(".hud__tally")).toBeVisible();
    await guest.screenshot({ path: testInfo.outputPath("continued-from-card.png") });
  });
});
