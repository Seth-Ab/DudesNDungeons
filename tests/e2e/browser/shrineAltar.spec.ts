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

const ALTAR_ID = "a1747000-0000-4000-8000-000000000001";
const OFFER = ["iron-will-scroll", "lever-sense-scroll"];

interface Frame {
  type: string;
  location?: string;
  players?: { position: { x: number; y: number } }[];
  dungeon?: { altars?: unknown[]; lightSources?: unknown[] };
}

type Point = { x: number; y: number };

interface Altar {
  frames: () => number;
  /** Where the altar stands, fixed by the first dungeon frame. */
  position: () => Point | null;
  /** The `playerInteract` messages the page sent. */
  interactions: () => Record<string, unknown>[];
  /** The party takes the first scroll: the server would cage the second. */
  take: () => void;
}

/**
 * A real run's seed is random, so its shrine is not in view. This proxies the client's socket and
 * stands an altar and its candle beside the party in each dungeon frame, with the wire fields the
 * server sends, to prove the client draws the three states, names the scroll in the prompt and
 * sends the choice. That the generator places a shrine, and the rules of taking, are covered by the
 * server tests. The altar stands where the player first appears, which is open floor, so it is
 * within reach from the start; the snapshot carries no map to pick another spot from.
 */
async function standAltarBeside(page: Page): Promise<Altar> {
  let frames = 0;
  let taken: string | null = null;
  let at: Point | null = null;
  const sent: Record<string, unknown>[] = [];
  await page.routeWebSocket(GAME_SOCKET, (client) => {
    const server = client.connectToServer();
    client.onMessage((message) => {
      if (typeof message === "string" && message.includes('"playerInteract"')) {
        sent.push(JSON.parse(message) as Record<string, unknown>);
      }
      server.send(message);
    });
    server.onMessage((message) => {
      if (typeof message !== "string") return client.send(message);
      const frame = JSON.parse(message) as Frame;
      const self = frame.players?.[0]?.position;
      if (frame.type === "stateSnapshot" && frame.location === "dungeon" && frame.dungeon && self) {
        frames += 1;
        at ??= { x: self.x, y: self.y };
        frame.dungeon.altars = [{ id: ALTAR_ID, position: at, offer: OFFER, taken }];
        frame.dungeon.lightSources = [
          ...(frame.dungeon.lightSources ?? []),
          {
            id: "a1747000-0000-4000-8000-000000000002",
            name: "Shrine Candle",
            kind: "fixed",
            position: { x: at.x + 2.5, y: at.y },
            radius: 4,
            fixture: "candle",
          },
        ];
      }
      client.send(JSON.stringify(frame));
    });
  });
  return { frames: () => frames, position: () => at, interactions: () => sent, take: () => void (taken = OFFER[0]!) };
}

const track = trackContexts();

async function openPlayer(browser: Browser, name: string, roomCode?: string) {
  const context = track(await browser.newContext({ viewport: { width: 1280, height: 720 } }));
  const page = await context.newPage();
  const altar = await standAltarBeside(page);
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
  return { page, altar };
}

const takePrompt = (page: Page) => page.locator(".hud__prompt", { hasText: "Take Scroll of" });

test.describe("Shrine altars", () => {
  test("two clients see the offered altar, take a scroll by name, and see the second caged", async ({ browser }, testInfo) => {
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
      expect(host.altar.frames()).toBeGreaterThan(0);
      expect(guest.altar.frames()).toBeGreaterThan(0);
    }).toPass({ timeout: 40_000 });
    await host.page.waitForTimeout(1_000);

    // Offered: the altar and its candle are drawn, and the prompt names the scroll to take.
    await expect(takePrompt(host.page)).toBeVisible({ timeout: 10_000 });
    await expect(takePrompt(host.page)).toContainText("Take Scroll of Iron Will");
    await host.page.screenshot({ path: testInfo.outputPath("shrine-altar-host-offered.png") });
    await guest.page.screenshot({ path: testInfo.outputPath("shrine-altar-guest-offered.png") });

    // Interacting sends the choice the prompt named.
    await host.page.keyboard.press("e");
    const atAltar = () => host.altar.interactions().filter((message) => message.targetId === ALTAR_ID);
    await expect.poll(() => atAltar().length).toBeGreaterThan(0);
    expect(atAltar()[0]).toMatchObject({
      type: "playerInteract",
      targetId: ALTAR_ID,
      choiceItemId: OFFER[0],
    });

    // Taken: the chosen scroll is gone and the other is caged, for both clients, and nothing is left to take.
    host.altar.take();
    guest.altar.take();
    await expect(takePrompt(host.page)).toBeHidden({ timeout: 10_000 });
    await host.page.screenshot({ path: testInfo.outputPath("shrine-altar-host-caged.png") });
    await guest.page.screenshot({ path: testInfo.outputPath("shrine-altar-guest-caged.png") });
  });
});
