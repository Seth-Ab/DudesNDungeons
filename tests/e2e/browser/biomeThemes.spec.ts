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

const THEMES = ["crypt", "fungal", "ossuary"] as const;
type Theme = (typeof THEMES)[number];

/**
 * The shipped content has one biome, drawn as stone, so a real run never arrives themed. Each biome
 * names its theme on the server and `generation.test.ts` proves a run carries it; this proxies the
 * client's socket and sets that theme on the run's map, to prove the client draws it. Everything
 * else in the frame is the real server's.
 */
async function themeTheRun(page: Page, theme: Theme): Promise<{ inDungeon: () => boolean }> {
  let inDungeon = false;
  await page.routeWebSocket(/:8080/, (client) => {
    const server = client.connectToServer();
    client.onMessage((message) => server.send(message));
    server.onMessage((message) => {
      if (typeof message !== "string") return client.send(message);
      const frame = JSON.parse(message) as { type: string; location?: string; dungeon?: { map?: { theme?: string } } };
      if (frame.type === "stateSnapshot" && frame.location === "dungeon" && frame.dungeon?.map) {
        frame.dungeon.map.theme = theme;
        inDungeon = true;
      }
      client.send(JSON.stringify(frame));
    });
  });
  return { inDungeon: () => inDungeon };
}

/**
 * The average colour of the game canvas's masonry and floor, as [r, g, b]: not the shade, and not
 * anything bright, which keeps a torch's flame and a player's sprite out of the average.
 */
async function averageColour(page: Page): Promise<[number, number, number] | null> {
  // A string, evaluated in the page, so the spec needs no DOM types.
  return page.evaluate<[number, number, number] | null>(`(() => {
    // The game canvas is the biggest one on the page; the minimap and previews are small.
    const canvas = [...document.querySelectorAll("canvas")].sort((a, b) => b.width * b.height - a.width * a.height)[0];
    const { data } = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
    const sum = [0, 0, 0];
    let counted = 0;
    for (let index = 0; index < data.length; index += 4) {
      const [r, g, b] = [data[index], data[index + 1], data[index + 2]];
      if (r + g + b < 60 || Math.max(r, g, b) > 110) continue;
      sum[0] += r;
      sum[1] += g;
      sum[2] += b;
      counted += 1;
    }
    return counted === 0 ? null : sum.map((channel) => channel / counted);
  })()`);
}

const track = trackContexts();

/** Opens a themed client that creates a room, or joins `roomCode`, and waits in the hub. */
async function openPlayer(browser: Browser, name: string, theme: Theme, roomCode?: string) {
  const context = track(await browser.newContext({ viewport: { width: 1280, height: 720 } }));
  const page = await context.newPage();
  const run = await themeTheRun(page, theme);
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
  return { page, run };
}

test.describe("Biome themes", () => {
  for (const theme of THEMES) {
    test(`a ${theme} run draws its walls and floors in the ${theme} palette on both clients`, async ({ browser }, testInfo) => {
      test.setTimeout(180_000);
      const host = await openPlayer(browser, "Maya", theme);
      const room = host.page.locator(".hud__stat", { hasText: "Room:" }).locator("span");
      await expect(room).toHaveText(/^[A-Z0-9]{6}$/);
      const guest = await openPlayer(browser, "Theo", theme, (await room.textContent()) ?? "");
      await expect(host.page.locator(".hud__frames")).toContainText("Theo", { timeout: 15_000 });

      // The guest only readies up; the host walks to the gate for the party.
      for (const { page } of [host, guest]) await page.getByRole("button", { name: "Ready" }).click();
      for (const waypoint of TO_GATE) await walkTo(host.page, waypoint, 0.8);
      await walkTo(host.page, GATE, 1);
      await expect(async () => {
        await host.page.keyboard.press("e");
        await host.page.waitForTimeout(250);
        expect(host.run.inDungeon() && guest.run.inDungeon()).toBe(true);
      }).toPass({ timeout: 40_000 });
      await host.page.waitForTimeout(1_000);

      for (const [label, { page }] of [["host", host], ["guest", guest]] as const) {
        await page.screenshot({ path: testInfo.outputPath(`biome-${theme}-${label}.png`) });
        // Nothing is drawn until the first lit tiles arrive, so wait for some masonry to average.
        await expect.poll(() => averageColour(page), { timeout: 10_000 }).not.toBeNull();
        const [r, g, b] = (await averageColour(page))!;
        if (theme === "crypt") expect(b).toBeGreaterThan(r);
        if (theme === "fungal") expect(g).toBeGreaterThan(Math.max(r, b));
        if (theme === "ossuary") expect(r).toBeGreaterThan(b);
      }
    });
  }
});
