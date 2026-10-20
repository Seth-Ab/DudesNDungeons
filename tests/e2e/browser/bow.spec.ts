import { expect, test, type Browser, type Page } from "@playwright/test";
import { enterHub } from "./designScreen.js";

/** World positions on the Weapons counter: authored (16.25, 5.3125) and (15.875, 5.3125). */
const BOW = { x: 66.5, y: 22.75 };
const ARROWS = { x: 65, y: 22.75 };
/** From the first spawn, round the north of the plaza to the floor in front of the Weapons stall. */
const TO_WEAPONS = [
  { x: 33.5, y: 29.5 },
  { x: 33.5, y: 17.5 },
  { x: 57.5, y: 17.5 },
  { x: 57.5, y: 25.5 },
];
/**
 * The plaza's open north row, level with the first training dummy at world (77.5, 13.5) and ten
 * units short of it: further than a short draw reaches (about 6) and inside a full one (14).
 */
const SHOOTING_SPOT = { x: 67.5, y: 13.5 };
const BACK_TO_ROW = [
  { x: 57.5, y: 25.5 },
  { x: 57.5, y: 13.5 },
];
/**
 * Where the watching teammate stands: just off the row, beside the archer, so the arrows pass in
 * sight. A client is only sent what it can see, within a torch's radius of someone.
 */
const WATCH_SPOT = { x: 70.5, y: 15.5 };

/** How long each draw is held. Full draw is 2000 ms in `content/items/hunting-bow.json`. */
const TAP_MS = 400;
const FULL_MS = 2300;

/**
 * The ids of every arrow this page is sent, off the snapshot socket. The arrow is canvas-drawn, so
 * the frames are how the test sees what the client was given to draw.
 */
function recordFlights(page: Page): Set<string> {
  const flights = new Set<string>();
  page.on("websocket", (socket) => {
    socket.on("framereceived", ({ payload }) => {
      if (typeof payload !== "string" || !payload.includes('"stateSnapshot"')) return;
      const message = JSON.parse(payload) as { dungeon: { projectiles: { id: string }[] } };
      for (const arrow of message.dungeon.projectiles) flights.add(arrow.id);
    });
  });
  return flights;
}

/** Arrow hits this page has been sent, counted off the socket (the action feed shows repeats once). */
function countHits(page: Page): { count: number } {
  const hits = { count: 0 };
  page.on("websocket", (socket) => {
    socket.on("framereceived", ({ payload }) => {
      if (typeof payload !== "string" || !payload.includes('"attackResolved"')) return;
      const message = JSON.parse(payload) as { type?: string; damage?: number };
      if (message.type === "attackResolved" && (message.damage ?? 0) > 0) hits.count += 1;
    });
  });
  return hits;
}

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

/** Steers by the debug readout, as the other hub specs do, so a slow machine still arrives. */
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

/** Walks into the counter from below and picks up whatever the prompt offers. */
async function pickUpFrom(page: Page, item: { x: number; y: number }, prompt: string): Promise<void> {
  await walkTo(page, { x: item.x, y: item.y + 1.75 }, 0.3);
  await page.keyboard.down("w");
  await page.waitForTimeout(400);
  await page.keyboard.up("w");
  await expect(page.locator(".hud__prompt", { hasText: prompt })).toBeVisible();
  await page.keyboard.press("f");
}

/** A step east, so the player faces east and stands still, then the draw key is held for `ms`. */
async function faceEast(page: Page): Promise<void> {
  await page.keyboard.down("d");
  await page.waitForTimeout(80);
  await page.keyboard.up("d");
  await page.waitForTimeout(150);
}

async function drawEast(page: Page, ms: number): Promise<void> {
  await faceEast(page);
  await page.keyboard.down("r");
  await page.waitForTimeout(ms);
  await page.keyboard.up("r");
}

test.describe("Hunting bow", () => {
  test("a held draw flies further than a tap, and a teammate sees both arrows fly and the full draw reach the dummy", async ({
    browser,
  }, testInfo) => {
    test.setTimeout(150_000);
    const host = await openPlayer(browser);
    const hostFlights = recordFlights(host);
    const hostHits = countHits(host);
    await host.getByPlaceholder("Your name").fill("Maya");
    await host.getByRole("button", { name: "Create a new dungeon" }).click();
    await enterHub(host);
    const room = host.locator(".hud__stat", { hasText: "Room:" }).locator("span");
    await expect(room).toHaveText(/^[A-Z0-9]{6}$/);
    const roomCode = (await room.textContent()) ?? "";

    const guest = await openPlayer(browser);
    const guestFlights = recordFlights(guest);
    const guestHits = countHits(guest);
    await guest.getByPlaceholder("Your name").fill("Theo");
    await guest.getByPlaceholder(/Room code/).fill(roomCode);
    await guest.getByRole("button", { name: "Join dungeon" }).click();
    await enterHub(guest);
    await expect(host.locator(".hud__frames")).toContainText("Theo", { timeout: 15_000 });
    await expect(host.getByText("Position:")).toContainText(/\d+\.\d+, \d+\.\d+/);
    await expect(guest.getByText("Position:")).toContainText(/\d+\.\d+, \d+\.\d+/);
    // The guest spawns elsewhere than the host: east along its own row to the clear column the
    // host also uses, north to the yard's row, then east to the watching spot.
    await walkTo(guest, { x: 57.5, y: (await position(guest)).y }, 0.6);
    await walkTo(guest, { x: 57.5, y: WATCH_SPOT.y }, 0.6);
    await walkTo(guest, WATCH_SPOT, 0.6);

    for (const waypoint of TO_WEAPONS) await walkTo(host, waypoint, 0.6);
    await expect(async () => {
      await pickUpFrom(host, BOW, "Pick up Hunting Bow");
      await expect(host.locator(".hud__slot--held")).toHaveAttribute("aria-label", /Hunting Bow/, { timeout: 1000 });
    }).toPass({ timeout: 15_000 });
    await expect(async () => {
      await pickUpFrom(host, ARROWS, "Pick up Arrows");
      await expect(host.locator(".hud__slot:not(.hud__slot--held)").first()).toHaveAttribute(
        "aria-label",
        /Arrows \(5\)/,
        { timeout: 1000 },
      );
    }).toPass({ timeout: 15_000 });

    for (const waypoint of BACK_TO_ROW) await walkTo(host, waypoint, 0.6);
    await walkTo(host, SHOOTING_SPOT, 0.5);

    // A tap: the arrow flies, but a short draw falls well short of the dummy.
    await drawEast(host, TAP_MS);
    await expect.poll(() => hostFlights.size).toBe(1);
    await expect.poll(() => guestFlights.size).toBe(1);
    await host.waitForTimeout(1500);
    expect(hostHits.count).toBe(0);
    expect(guestHits.count).toBe(0);
    await walkTo(host, SHOOTING_SPOT, 0.5);

    // A full draw. Mid-draw the bar shows the server's fraction and the arrow reaches the dummy.
    await faceEast(host);
    await host.keyboard.down("r");
    await expect(host.locator(".hud__draw")).toBeVisible();
    await host.waitForTimeout(FULL_MS);
    await expect(host.locator(".hud__draw")).toHaveClass(/hud__draw--full/);
    await host.screenshot({ path: testInfo.outputPath("bow-full-draw.png") });
    await host.keyboard.up("r");
    await expect.poll(() => hostFlights.size).toBe(2);
    await expect.poll(() => guestFlights.size).toBe(2);
    await expect.poll(() => hostHits.count).toBeGreaterThan(0);
    await expect.poll(() => guestHits.count).toBeGreaterThan(0);
    await guest.screenshot({ path: testInfo.outputPath("bow-teammate-view.png") });
    await expect(host.locator(".hud__draw")).toBeHidden();

    // Two shots from five arrows.
    await expect(host.locator(".hud__slot:not(.hud__slot--held)").first()).toHaveAttribute(
      "aria-label",
      /Arrows \(3\)/,
    );
  });
});
