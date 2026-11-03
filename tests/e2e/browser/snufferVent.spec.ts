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

const TRAP_ID = "5a0f0e00-0000-4000-8000-000000000001";

type Phase = "armed" | "triggered";

interface Frame {
  type: string;
  location?: string;
  players?: { position: { x: number; y: number } }[];
  dungeon?: { traps?: unknown[] };
}

/**
 * A real run's seed is random, so a Snuffer Vent is rarely in view. This proxies the client's socket
 * and adds one, as the server sends it (`effect` and `phase`, never the amounts), a couple of tiles
 * from the first player in each dungeon frame, to prove every client draws the same soot-ring tell
 * and changes it with the phase. What the vent does to a torch and a flare is covered by
 * `tests/server/traps.test.ts`.
 */
async function proxyVent(page: Page) {
  let phase: Phase = "armed";
  let frames = 0;
  await page.routeWebSocket(GAME_SOCKET, (client) => {
    const server = client.connectToServer();
    client.onMessage((message) => server.send(message));
    server.onMessage((message) => {
      if (typeof message !== "string") return client.send(message);
      const frame = JSON.parse(message) as Frame;
      const anchor = frame.players?.[0]?.position;
      if (frame.type === "stateSnapshot" && frame.location === "dungeon" && frame.dungeon && anchor) {
        frames += 1;
        frame.dungeon.traps = [
          ...(frame.dungeon.traps ?? []),
          {
            id: TRAP_ID,
            typeId: "snuffer-vent",
            name: "Snuffer Vent",
            position: { x: anchor.x + 2, y: anchor.y },
            radius: 3,
            phase,
            effect: "snuffTorch",
          },
        ];
      }
      client.send(JSON.stringify(frame));
    });
  });
  return { frames: () => frames, set: (next: Phase) => void (phase = next) };
}

const track = trackContexts();

async function openPlayer(browser: Browser, name: string, roomCode?: string) {
  const context = track(await browser.newContext({ viewport: { width: 1280, height: 720 } }));
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const vent = await proxyVent(page);
  await page.goto("/?debug");
  await page.getByPlaceholder("Your name").fill(name);
  if (roomCode) {
    await page.getByPlaceholder(/Room code/).fill(roomCode);
    await page.getByRole("button", { name: "Join dungeon" }).click();
  } else {
    await page.getByRole("button", { name: "Create a new dungeon" }).click();
  }
  await enterHub(page);
  return { page, vent, errors };
}

test.describe("Snuffer Vent", () => {
  test("two clients draw the soot ring, and it changes once the vent has fired", async ({ browser }, testInfo) => {
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
      expect(host.vent.frames()).toBeGreaterThan(0);
      expect(guest.vent.frames()).toBeGreaterThan(0);
    }).toPass({ timeout: 40_000 });

    const players = [
      { name: "host", ...host },
      { name: "guest", ...guest },
    ];
    const armed = new Map<string, Buffer>();
    for (const player of players) {
      await player.page.waitForTimeout(500);
      armed.set(player.name, await player.page.screenshot({ path: testInfo.outputPath(`snuffer-vent-${player.name}-armed.png`) }));
    }

    host.vent.set("triggered");
    guest.vent.set("triggered");
    for (const player of players) {
      await player.page.waitForTimeout(500);
      const triggered = await player.page.screenshot({ path: testInfo.outputPath(`snuffer-vent-${player.name}-triggered.png`) });
      expect(triggered.equals(armed.get(player.name)!)).toBe(false);
    }

    expect([...host.errors, ...guest.errors]).toEqual([]);
  });
});
