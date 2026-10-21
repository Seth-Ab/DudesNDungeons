import { expect, test, type Browser, type Page } from "@playwright/test";
import { enterHub } from "./designScreen.js";

/**
 * A party in the hub, drawn as characters. Each page confirms the design screen's random look, then
 * rewrites its own `setAppearance` on the way out so the party is two known, different bodies, skins
 * and hair. The server still validates it. Two live canvases is what a two-core CI runner can keep
 * responsive; the recolouring of every skin, hair and party colour is covered by the compositor's
 * unit tests.
 */
const LOOKS = [
  { name: "Maya", appearance: { body: "girl", skinTone: "tan", hairStyle: "ponytail", hairColor: "ginger" } },
  { name: "Theo", appearance: { body: "guy", skinTone: "porcelain", hairStyle: "spiky", hairColor: "blonde" } },
] as const;

async function openPlayer(
  browser: Browser,
  appearance: (typeof LOOKS)[number]["appearance"],
  errors: string[],
): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.routeWebSocket(/:8080/, (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      if (typeof message !== "string") return server.send(message);
      const parsed = JSON.parse(message) as { type?: string };
      server.send(parsed.type === "setAppearance" ? JSON.stringify({ ...parsed, appearance }) : message);
    });
  });
  await page.goto("/");
  return page;
}

test.describe("Character sprites", () => {
  test("a two-player party is drawn with each player's look and party colour", async ({ browser }, testInfo) => {
    const errors: string[] = [];
    const [first, ...rest] = LOOKS;
    // Two live game pages: joining and drawing them takes longer than one.
    test.setTimeout(60_000);
    const host = await openPlayer(browser, first.appearance, errors);
    await host.getByPlaceholder("Your name").fill(first.name);
    await host.getByRole("button", { name: "Create a new dungeon" }).click();
    await enterHub(host);
    const room = host.locator(".hud__stat", { hasText: "Room:" }).locator("span");
    await expect(room).toHaveText(/^[A-Z0-9]{6}$/);
    const roomCode = (await room.textContent()) ?? "";

    const guests: Page[] = [];
    for (const look of rest) {
      const guest = await openPlayer(browser, look.appearance, errors);
      await guest.getByPlaceholder("Your name").fill(look.name);
      await guest.getByPlaceholder(/Room code/).fill(roomCode);
      await guest.getByRole("button", { name: "Join dungeon" }).click();
      await enterHub(guest);
      await expect(guest.locator(".hud__vitals")).toBeVisible();
      await expect(host.locator(".hud__frames")).toContainText(look.name, { timeout: 15_000 });
      guests.push(guest);
    }

    // Let the sheet decode and a few frames draw, then catch one guest mid-stride.
    await host.waitForTimeout(500);
    await host.screenshot({ path: testInfo.outputPath("hub-party-idle.png") });
    // The first guest spawns east of the fountain; east is open ground, so they keep walking.
    const walker = guests[0]!;
    await walker.keyboard.down("d");
    await walker.waitForTimeout(400);
    await host.screenshot({ path: testInfo.outputPath("hub-party-walking.png") });
    await host.screenshot({
      path: testInfo.outputPath("hub-party-close-up.png"),
      clip: { x: 560, y: 300, width: 420, height: 240 },
    });
    await walker.keyboard.up("d");
    await host.screenshot({ path: testInfo.outputPath("hub-party-after-walk.png") });

    expect(errors).toEqual([]);

    for (const page of [host, ...guests]) await page.context().close();
  });
});
