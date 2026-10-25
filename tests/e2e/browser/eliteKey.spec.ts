import { expect, test, type Browser, type Page } from "@playwright/test";
import { trackContexts } from "./contexts.js";
import { enterHub } from "./designScreen.js";
import { walkTo } from "./walk.js";

/** The hub gate in world units, and the road up to it from the spawn beside the fountain. */
const GATE = { x: 45.5, y: 5.5 };
const TO_GATE = [
  { x: 33.5, y: 29.5 },
  { x: 33.5, y: 17.5 },
  { x: 45.5, y: 17.5 },
];

interface Frame {
  type: string;
  location?: string;
  players?: { position: { x: number; y: number } }[];
  dungeon?: { monsters?: Record<string, unknown>[] };
}

/**
 * A real run starts at an entrance with no monsters in it, and the shipped seeds are random, so no
 * elite is waiting in view. This proxies the client's socket and stands one beside the party in each
 * frame, an Elite Ash Imp with the wire fields the server sends, to prove the client draws the
 * flag. That the generator places an elite, and what it drops, is covered by the server tests.
 */
async function standEliteBeside(page: Page): Promise<{ frames: () => number; stand: () => void }> {
  let frames = 0;
  let standing = false;
  await page.routeWebSocket(/:8080/, (client) => {
    const server = client.connectToServer();
    client.onMessage((message) => server.send(message));
    server.onMessage((message) => {
      if (typeof message !== "string") return client.send(message);
      const frame = JSON.parse(message) as Frame;
      const self = frame.players?.[0]?.position;
      if (frame.type === "stateSnapshot" && frame.location === "dungeon" && frame.dungeon?.monsters && self) {
        frames += 1;
        if (standing) frame.dungeon.monsters.push({
          id: "5e11e000-0000-4000-8000-000000000001",
          typeId: "ash-imp",
          name: "Elite Ash Imp",
          position: { x: self.x + 2, y: self.y },
          health: 36,
          maxHealth: 36,
          alive: true,
          boss: false,
          elite: true,
          action: "idle",
          behavior: "melee",
          windupProgress: 0,
          facing: { x: 0, y: 1 },
          hitRange: 1,
          hitArcCos: 0.5,
        });
      }
      client.send(JSON.stringify(frame));
    });
  });
  return { frames: () => frames, stand: () => void (standing = true) };
}

/**
 * How many canvas pixels are gold: red over green over a much lower blue. The elite's frame is
 * `colors.eliteEdge`, but the lightmap dims it, so this matches the hue rather than the exact
 * colour, and the spec compares a count before and after the elite appears.
 */
async function goldPixels(page: Page): Promise<number> {
  return page.evaluate<number>(`(() => {
    const canvas = [...document.querySelectorAll("canvas")].sort((a, b) => b.width * b.height - a.width * a.height)[0];
    const { data } = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
    let count = 0;
    for (let index = 0; index < data.length; index += 4) {
      const [r, g, b] = [data[index], data[index + 1], data[index + 2]];
      if (r >= 90 && r >= g && r - b >= 50 && g - b >= 25) count += 1;
    }
    return count;
  })()`);
}

const track = trackContexts();

async function openPlayer(browser: Browser, name: string, roomCode?: string) {
  const context = track(await browser.newContext({ viewport: { width: 1280, height: 720 } }));
  const page = await context.newPage();
  const elite = await standEliteBeside(page);
  await page.goto("/?debug");
  await page.getByPlaceholder("Your name").fill(name);
  if (roomCode) {
    await page.getByPlaceholder(/Room code/).fill(roomCode);
    await page.getByRole("button", { name: "Join dungeon" }).click();
  } else {
    await page.getByRole("button", { name: "Create a new dungeon" }).click();
  }
  await enterHub(page);
  await expect(page.getByText("Position:")).toContainText(/\d+\.\d+, \d+\.\d+/);
  return { page, elite };
}

test.describe("Elite monsters", () => {
  test("two clients in a run both draw an elite in a gold frame", async ({ browser }, testInfo) => {
    test.setTimeout(180_000);
    const host = await openPlayer(browser, "Maya");
    const room = host.page.locator(".hud__stat", { hasText: "Room:" }).locator("span");
    await expect(room).toHaveText(/^[A-Z0-9]{6}$/);
    const guest = await openPlayer(browser, "Theo", (await room.textContent()) ?? "");
    await expect(host.page.locator(".hud__frames")).toContainText("Theo", { timeout: 15_000 });

    // The guest spawns on the host's road to the gate, and bodies block, so it steps aside first,
    // then only readies up; the host walks to the gate for the party.
    await guest.page.keyboard.down("s");
    await guest.page.waitForTimeout(900);
    await guest.page.keyboard.up("s");
    for (const { page } of [host, guest]) await page.getByRole("button", { name: "Ready" }).click();
    for (const waypoint of TO_GATE) await walkTo(host.page, waypoint, 0.8);
    await walkTo(host.page, GATE, 1);
    await expect(async () => {
      await host.page.keyboard.press("e");
      await host.page.waitForTimeout(250);
      expect(host.elite.frames()).toBeGreaterThan(0);
      expect(guest.elite.frames()).toBeGreaterThan(0);
    }).toPass({ timeout: 40_000 });
    await host.page.waitForTimeout(1_000);

    for (const [label, { page, elite }] of [["host", host], ["guest", guest]] as const) {
      const before = await goldPixels(page);
      elite.stand();
      await expect.poll(async () => (await goldPixels(page)) - before, { timeout: 10_000 }).toBeGreaterThan(40);
      await page.screenshot({ path: testInfo.outputPath(`elite-key-${label}.png`) });
    }
  });
});
