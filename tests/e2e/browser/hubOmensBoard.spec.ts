import { expect, test, type Page } from "@playwright/test";
import { openCampMenu } from "./campMenu.js";
import { enterHub } from "./designScreen.js";
import { GAME_SOCKET } from "./ports.js";
import { walkTo } from "./walk.js";

/**
 * The next run's omens on the hub quest board and in the party's hub status. The server rolls the
 * omens at random, so the page's socket swaps in a fixed `hubState` and the test checks how it is drawn.
 */
const OMENS = [
  { id: "short-fuse", name: "Short Fuse", type: "warning", description: "Resistance falls sooner." },
  { id: "echoing-halls", name: "Echoing Halls", type: "anomaly", description: "Sound carries further." },
] as const;

/** Where the quest board's plates are drawn: the 28px-high, 6px-round panel `drawOmenBoard` fills. */
const RECORD_OMEN_PLATES = `(() => {
  const proto = CanvasRenderingContext2D.prototype;
  const roundRect = proto.roundRect;
  let frame = [];
  window.__omenPlates = [];
  proto.roundRect = function (x, y, width, height, radius) {
    if (radius === 6 && height === 28 && this.canvas.classList.contains("game-canvas")) {
      frame.push({ x, y, width, height });
    }
    return roundRect.apply(this, arguments);
  };
  const tick = () => {
    window.__omenPlates = frame;
    frame = [];
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})();`;

async function openHub(page: Page, omens: readonly unknown[]): Promise<void> {
  await page.routeWebSocket(GAME_SOCKET, (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => server.send(message));
    server.onMessage((message) => {
      if (typeof message !== "string") return socket.send(message);
      const parsed = JSON.parse(message) as { type?: string };
      socket.send(parsed.type === "hubState" ? JSON.stringify({ type: "hubState", nextRun: { omens } }) : message);
    });
  });
  await page.addInitScript(RECORD_OMEN_PLATES);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await page.getByPlaceholder("Your name").fill("Maya");
  await page.getByRole("button", { name: "Create a new dungeon" }).click();
  await enterHub(page);
}

const platesDrawn = (page: Page) => page.evaluate<number>(`window.__omenPlates.length`);

test.describe("Hub quest board omens", () => {
  test("lists the omens in the hub status with a shape and a word for each type", async ({ page }, testInfo) => {
    await openHub(page, OMENS);

    const rows = page.locator(".hud__hub-omen");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toHaveText("▲Warning: Short Fuse");
    await expect(rows.nth(1)).toHaveText("◆Anomaly: Echoing Halls");
    await expect(rows.nth(0)).toHaveAttribute("title", /Resistance falls sooner/);

    // The shapes and words survive every density, since colour is not what carries them.
    await (await openCampMenu(page)).getByRole("button", { name: "Controls" }).click();
    const labels = await page.getByLabel("HUD density").locator("option").allTextContents();
    await page.getByLabel("HUD density").selectOption({ label: labels.find((text) => /^Minimal/.test(text)) ?? labels[0]! });
    await page.keyboard.press("Escape");
    await expect(rows.nth(0)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("hub-omens-status.png") });
  });

  test("says so when the next run has no omen", async ({ page }) => {
    await openHub(page, []);
    await expect(page.locator(".hud__hub-omen")).toHaveText("No omens");
  });

  test("draws a plate per omen above the board only within reach of it", async ({ page }, testInfo) => {
    await openHub(page, OMENS);
    await expect.poll(() => platesDrawn(page)).toBe(0);

    await walkTo(page, { x: 16, y: 29 }, 1);
    await expect.poll(() => platesDrawn(page)).toBe(2);
    await page.screenshot({ path: testInfo.outputPath("hub-omens-board.png") });
  });

  test("keeps the omen plates apart when the board is near the top of a short screen", async ({ page }) => {
    await openHub(page, OMENS);
    await page.setViewportSize({ width: 1280, height: 360 });
    await walkTo(page, { x: 16, y: 29 }, 1);
    await expect.poll(() => platesDrawn(page)).toBe(2);

    const plates = await page.evaluate<{ y: number; height: number }[]>(`window.__omenPlates`);
    const [upper, lower] = [...plates].sort((a, b) => a.y - b.y);
    expect(lower!.y).toBeGreaterThanOrEqual(upper!.y + upper!.height);
  });
});
