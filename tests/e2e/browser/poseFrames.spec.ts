import { expect, test, type Browser, type Page } from "@playwright/test";
import { enterHub } from "./designScreen.js";
import { position, walkTo } from "./walk.js";

/**
 * The fountain rim's west seat and the floor in front of it, as in `hubSeats.spec.ts`: the guest
 * sits there while the host looks on.
 */
const IN_FRONT = { x: 39, y: 29.5 };
const PIXELS_PER_WORLD_UNIT = 32;
/** Half the side, in CSS pixels, of the square around the guest that is compared. */
const WATCH = 40;

/** Whether the onlooker's snapshots report the walker as downed, as the server's would after a fatal hit. */
const watcherSees = { walkerDowned: false };

async function openPlayer(browser: Browser, reportsDowned: boolean): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  if (reportsDowned) {
    await page.routeWebSocket(/:8080/, (socket) => {
      const server = socket.connectToServer();
      socket.onMessage((message) => server.send(message));
      server.onMessage((message) => {
        if (typeof message !== "string") return socket.send(message);
        const parsed = JSON.parse(message) as { type?: string; players?: { name: string; health: number }[] };
        if (parsed.type === "stateSnapshot" && watcherSees.walkerDowned && parsed.players) {
          for (const player of parsed.players) if (player.name === "Maya") player.health = 0;
          return socket.send(JSON.stringify(parsed));
        }
        socket.send(message);
      });
    });
  }
  await page.goto("/?debug");
  return page;
}

/** The onlooker's canvas around the walker, as RGBA, with the walker standing where `walkerAt` says. */
async function around(watcher: Page, walkerAt: { x: number; y: number }): Promise<number[]> {
  const watcherAt = await position(watcher);
  const { dx, dy } = { dx: walkerAt.x - watcherAt.x, dy: walkerAt.y - watcherAt.y };
  // A string, evaluated in the page, so the spec needs no DOM types.
  return watcher.evaluate<number[]>(`(() => {
    const canvas = document.querySelector("canvas.game-canvas");
    const ratio = canvas.width / canvas.clientWidth;
    const x = Math.round((canvas.clientWidth / 2 + ${dx} * ${PIXELS_PER_WORLD_UNIT} - ${WATCH}) * ratio);
    const y = Math.round((canvas.clientHeight / 2 + ${dy} * ${PIXELS_PER_WORLD_UNIT} - ${WATCH} - 16) * ratio);
    const size = Math.round(${WATCH} * 2 * ratio);
    return Array.from(canvas.getContext("2d").getImageData(x, y, size, size).data);
  })()`);
}

/** How many pixels differ visibly between two grabs of the same square. */
function changed(a: number[], b: number[]): number {
  let count = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i]! - b[i]!) + Math.abs(a[i + 1]! - b[i + 1]!) + Math.abs(a[i + 2]! - b[i + 2]!) > 60) {
      count += 1;
    }
  }
  return count;
}

test.describe("Character pose frames", () => {
  test("a downed and a seated figure are drawn in their own frames for another client", async ({ browser }, testInfo) => {
    test.setTimeout(90_000);
    const errors: string[] = [];
    watcherSees.walkerDowned = false;

    const walker = await openPlayer(browser, false);
    walker.on("pageerror", (error) => errors.push(error.message));
    await walker.getByPlaceholder("Your name").fill("Maya");
    await walker.getByRole("button", { name: "Create a new dungeon" }).click();
    await enterHub(walker);
    const room = walker.locator(".hud__stat", { hasText: "Room:" }).locator("span");
    await expect(room).toHaveText(/^[A-Z0-9]{6}$/);
    const roomCode = (await room.textContent()) ?? "";

    const watcher = await openPlayer(browser, true);
    watcher.on("pageerror", (error) => errors.push(error.message));
    await watcher.getByPlaceholder("Your name").fill("Theo");
    await watcher.getByPlaceholder(/Room code/).fill(roomCode);
    await watcher.getByRole("button", { name: "Join dungeon" }).click();
    await enterHub(watcher);
    await expect(walker.locator(".hud__frames")).toContainText("Theo", { timeout: 15_000 });

    // Downed first, where the party spawns on plain cobbles: the fountain's water shimmers.
    const standingAt = await position(walker);
    // Two grabs of the same standing walker say how much the lighting and a blink move on their own.
    const standing = await around(watcher, standingAt);
    await watcher.waitForTimeout(250);
    const noise = changed(standing, await around(watcher, standingAt));

    watcherSees.walkerDowned = true;
    await expect(watcher.locator(".hud__frames")).toContainText("✖", { timeout: 10_000 });
    await watcher.waitForTimeout(250);
    const downed = await around(watcher, standingAt);
    await watcher.screenshot({ path: testInfo.outputPath("pose-onlooker-sees-downed.png") });
    expect(changed(standing, downed), "the downed figure is not the standing one").toBeGreaterThan(noise + 150);

    watcherSees.walkerDowned = false;
    await expect(watcher.locator(".hud__frames")).not.toContainText("✖", { timeout: 10_000 });
    await walkTo(walker, IN_FRONT, 0.3);
    await expect(async () => {
      await walker.keyboard.press("e");
      await expect(walker.locator(".hud__prompt", { hasText: "Sit" })).toBeHidden({ timeout: 1000 });
    }).toPass({ timeout: 10_000 });
    await watcher.waitForTimeout(250);
    const seatedAt = await position(walker);
    const seated = await around(watcher, seatedAt);
    await watcher.screenshot({ path: testInfo.outputPath("pose-onlooker-sees-seated.png") });
    await walker.screenshot({ path: testInfo.outputPath("pose-seated-own-view.png") });
    // A step stands them up in front of the rim. The seat they sat in is then empty, and it differs from the
    // seated figure by more than the fountain's own shimmer, which the same square a moment apart shows.
    await watcher.waitForTimeout(250);
    const seatedNoise = changed(seated, await around(watcher, seatedAt));
    await walker.keyboard.down("d");
    await walker.waitForTimeout(150);
    await walker.keyboard.up("d");
    await expect.poll(async () => (await position(walker)).x).toBeLessThan(seatedAt.x - 0.25);
    await watcher.waitForTimeout(500);
    expect(changed(seated, await around(watcher, seatedAt)), "the seated figure is drawn").toBeGreaterThan(seatedNoise + 150);

    expect(errors).toEqual([]);
    await walker.context().close();
    await watcher.context().close();
  });
});
