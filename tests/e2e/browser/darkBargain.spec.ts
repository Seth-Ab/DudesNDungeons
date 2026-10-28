import { expect, test, type Browser, type Page } from "@playwright/test";
import { trackContexts } from "./contexts.js";
import { enterHub } from "./designScreen.js";
import { walkTo } from "./walk.js";
import { GAME_SOCKET } from "./ports.js";

/** The hub gate in world units, and the road up to it from the spawn beside the fountain. */
const GATE = { x: 45.5, y: 5.5 };
const TO_GATE = [
  { x: 33.5, y: 29.5 },
  { x: 33.5, y: 17.5 },
  { x: 45.5, y: 17.5 },
];

const ROOM_ID = "ba76a100-0000-4000-8000-000000000001";

type Status = "counting" | "struck" | "broken";

interface Frame {
  type: string;
  location?: string;
  dungeon?: { bargain?: unknown };
}

/**
 * A real run's seed is random, so its shrine is not in view. This proxies the client's socket and
 * adds the Dark Bargain a shrine room would carry to each dungeon frame, with the wire fields the
 * server sends, to prove the client words each of its three states. Whether the bargain starts,
 * strikes or breaks is covered by `tests/server/darkBargain.test.ts`.
 */
async function proxyBargain(page: Page) {
  let status: Status | null = null;
  let frames = 0;
  await page.routeWebSocket(GAME_SOCKET, (client) => {
    const server = client.connectToServer();
    client.onMessage((message) => server.send(message));
    server.onMessage((message) => {
      if (typeof message !== "string") return client.send(message);
      const frame = JSON.parse(message) as Frame;
      if (frame.type === "stateSnapshot" && frame.location === "dungeon" && frame.dungeon) {
        frames += 1;
        if (status) frame.dungeon.bargain = { roomId: ROOM_ID, status, remainingMs: status === "counting" ? 12_000 : 0 };
      }
      client.send(JSON.stringify(frame));
    });
  });
  return { frames: () => frames, set: (next: Status) => void (status = next) };
}

const track = trackContexts();

async function openPlayer(browser: Browser, name: string, roomCode?: string) {
  const context = track(await browser.newContext({ viewport: { width: 1280, height: 720 } }));
  const page = await context.newPage();
  const bargain = await proxyBargain(page);
  await page.goto("/?debug");
  await page.getByPlaceholder("Your name").fill(name);
  if (roomCode) {
    await page.getByPlaceholder(/Room code/).fill(roomCode);
    await page.getByRole("button", { name: "Join dungeon" }).click();
  } else {
    await page.getByRole("button", { name: "Create a new dungeon" }).click();
  }
  await enterHub(page);
  return { page, bargain };
}

test.describe("Dark Bargain", () => {
  test("two clients are told the dark is listening, then what it took, then that the bargain is lost", async ({ browser }, testInfo) => {
    test.setTimeout(180_000);
    const host = await openPlayer(browser, "Maya");
    const room = host.page.locator(".hud__stat", { hasText: "Room:" }).locator("span");
    await expect(room).toHaveText(/^[A-Z0-9]{6}$/);
    const guest = await openPlayer(browser, "Theo", (await room.textContent()) ?? "");
    await expect(host.page.locator(".hud__frames")).toContainText("Theo", { timeout: 15_000 });

    await guest.page.keyboard.down("s");
    await guest.page.waitForTimeout(900);
    await guest.page.keyboard.up("s");
    for (const { page } of [host, guest]) await page.getByRole("button", { name: "Ready" }).click();
    for (const waypoint of TO_GATE) await walkTo(host.page, waypoint, 0.8);
    await walkTo(host.page, GATE, 1);
    await expect(async () => {
      await host.page.keyboard.press("e");
      await host.page.waitForTimeout(250);
      expect(host.bargain.frames()).toBeGreaterThan(0);
      expect(guest.bargain.frames()).toBeGreaterThan(0);
    }).toPass({ timeout: 40_000 });

    const toasts = (page: Page) => page.locator(".hud__toast");
    for (const [status, text] of [
      ["counting", "keep every torch out (12s)"],
      ["struck", "The chests are richer"],
      ["broken", "The bargain is lost"],
    ] as const) {
      host.bargain.set(status);
      guest.bargain.set(status);
      for (const { page } of [host, guest]) await expect(toasts(page).filter({ hasText: text })).toBeVisible({ timeout: 10_000 });
      await host.page.screenshot({ path: testInfo.outputPath(`dark-bargain-host-${status}.png`) });
      await guest.page.screenshot({ path: testInfo.outputPath(`dark-bargain-guest-${status}.png`) });
    }
  });
});
