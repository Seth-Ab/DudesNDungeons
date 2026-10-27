import { expect, test, type Browser, type Page } from "@playwright/test";
import { trackContexts } from "./contexts.js";
import { enterHub } from "./designScreen.js";
import { position, walkTo } from "./walk.js";
import { GAME_SOCKET } from "./ports.js";

const track = trackContexts();

/** Row 3, open from wall to wall above the fountain, and row 7 east of it. */
const NORTH_ROAD_Y = 14;
const EAST_ROW_Y = 30;
/** The column east of the fountain that runs from the north road down to the Wardrobe stall. */
const EAST_COLUMN_X = 74;
/** In front of the north-facing Wardrobe stall, inside the wardrobe room (authored 15..17, 8..10). */
const AT_WARDROBE = { x: 66, y: 34 };

interface WornCosmetics {
  hat: string | null;
  cloak: string | null;
  dye: string | null;
}

async function openPlayer(browser: Browser, watch?: (message: string) => void): Promise<Page> {
  const context = track(await browser.newContext({ viewport: { width: 1280, height: 720 } }));
  const page = await context.newPage();
  if (watch) {
    await page.routeWebSocket(GAME_SOCKET, (socket) => {
      const server = socket.connectToServer();
      server.onMessage((message) => {
        if (typeof message === "string") watch(message);
        socket.send(message);
      });
    });
  }
  await page.goto("/?debug");
  return page;
}

/** From either spawn beside the fountain, round its north side and down the east column to the stall. */
async function walkToWardrobe(page: Page): Promise<void> {
  const start = await position(page);
  const route =
    start.x > 44
      ? [{ x: start.x, y: EAST_ROW_Y }, { x: EAST_COLUMN_X, y: EAST_ROW_Y }]
      : [
          { x: 34, y: start.y },
          { x: 34, y: NORTH_ROAD_Y },
          { x: EAST_COLUMN_X, y: NORTH_ROAD_Y },
        ];
  for (const waypoint of [...route, { x: EAST_COLUMN_X, y: AT_WARDROBE.y }, AT_WARDROBE]) {
    await walkTo(page, waypoint, 0.6);
  }
}

test.describe("Hub wardrobe", () => {
  test("a player wears starter cosmetics that a teammate sees, and an unaffordable dye is refused", async ({
    browser,
  }, testInfo) => {
    test.setTimeout(120_000);

    const host = await openPlayer(browser);
    await host.getByPlaceholder("Your name").fill("Maya");
    await host.getByRole("button", { name: "Create a new dungeon" }).click();
    const room = host.locator(".hud__stat", { hasText: "Room:" }).locator("span");
    await expect(room).toHaveText(/^[A-Z0-9]{6}$/);
    const roomCode = (await room.textContent()) ?? "";
    await enterHub(host);
    await expect(host.getByText("Position:")).toContainText(/\d+\.\d+, \d+\.\d+/);

    // The guest keeps the host's cosmetics from the newest snapshot or join that names them.
    let hostId: string | null = null;
    let seen: WornCosmetics | null = null;
    const guest = await openPlayer(browser, (raw) => {
      const message = JSON.parse(raw) as {
        type: string;
        players?: { id: string; name: string; cosmetics: WornCosmetics }[];
      };
      const players = message.type === "sessionJoined" || message.type === "stateSnapshot" ? message.players : undefined;
      const maya = players?.find((player) => player.id === hostId || player.name === "Maya");
      if (maya) {
        hostId = maya.id;
        seen = maya.cosmetics;
      }
    });
    await guest.getByPlaceholder("Your name").fill("Sam");
    await guest.getByPlaceholder(/Room code/).fill(roomCode);
    await guest.getByRole("button", { name: "Join dungeon" }).click();
    await enterHub(guest);
    await expect.poll(() => seen).toEqual({ hat: null, cloak: null, dye: null, trail: null, flame: null });

    await walkToWardrobe(host);
    await expect(host.locator(".hud__prompt", { hasText: "Browse the wardrobe" })).toBeVisible();
    const wardrobe = host.getByRole("dialog", { name: "Wardrobe" });
    await expect(async () => {
      await host.keyboard.press("e");
      await expect(wardrobe).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 10_000 });
    await expect(wardrobe).toContainText("Your coin: 0");

    // Every profile owns the starters, so they can be worn straight away.
    await wardrobe.getByRole("button", { name: "Wear: Leather Cap" }).click();
    await expect(wardrobe.getByRole("button", { name: "Take off: Leather Cap" })).toBeVisible();
    await wardrobe.getByRole("tab", { name: "Cloaks" }).click();
    await wardrobe.getByRole("button", { name: "Wear: Traveler's Cape" }).click();
    await expect(wardrobe.getByRole("button", { name: "Take off: Traveler's Cape" })).toBeVisible();

    await expect.poll(() => seen).toEqual({ hat: "leather-cap", cloak: "traveler-cape", dye: null, trail: null, flame: null });

    // A new profile has no coin: the server refuses the dye and the wardrobe says why.
    await wardrobe.getByRole("tab", { name: "Outfit dyes" }).click();
    await wardrobe.getByRole("button", { name: "Buy Bone Dye for 15 coin" }).click();
    await expect(wardrobe.locator(".hud__shop-notice")).toHaveText("Not enough coin.");
    await expect(wardrobe).toContainText("Your coin: 0");
    await host.screenshot({ path: testInfo.outputPath("wardrobe-panel.png") });

    // Trying on a card previews it without sending anything.
    await wardrobe.getByRole("tab", { name: "Hats" }).click();
    await wardrobe.getByRole("button", { name: "Try on Wizard Hat" }).click();
    await expect(wardrobe.getByRole("button", { name: "Try on Wizard Hat" })).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => seen).toEqual({ hat: "leather-cap", cloak: "traveler-cape", dye: null, trail: null, flame: null });

    await wardrobe.getByRole("button", { name: "Take off: Leather Cap" }).click();
    await expect.poll(() => seen).toEqual({ hat: null, cloak: "traveler-cape", dye: null, trail: null, flame: null });

    // Walking away from the stall shuts the wardrobe.
    await walkTo(host, { x: EAST_COLUMN_X, y: AT_WARDROBE.y }, 0.6);
    await expect(wardrobe).toBeHidden();
    await guest.screenshot({ path: testInfo.outputPath("wardrobe-teammate.png") });
  });
});
