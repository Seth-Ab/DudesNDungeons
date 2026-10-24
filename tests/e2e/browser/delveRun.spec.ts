import { expect, test, type Browser, type Page } from "@playwright/test";
import { enterHub } from "./designScreen.js";
import { walkTo } from "./walk.js";

/** The hub gate in world units, and the road up to it from the spawns beside the fountain. */
const GATE = { x: 45.5, y: 5.5 };
const TO_GATE = [
  { x: 33.5, y: 29.5 },
  { x: 33.5, y: 17.5 },
  { x: 45.5, y: 17.5 },
];

interface Room {
  kind: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
interface Snapshot {
  location: "hub" | "dungeon";
  dungeon: { rooms: Room[] };
}

/** The latest snapshot this client was sent, read off its WebSocket rather than off the client's state. */
function watchServer(page: Page): { latest: () => Snapshot | null } {
  let latest: Snapshot | null = null;
  page.on("websocket", (socket) =>
    socket.on("framereceived", ({ payload }) => {
      if (typeof payload !== "string") return;
      const message = JSON.parse(payload) as { type: string };
      if (message.type === "stateSnapshot") latest = message as unknown as Snapshot;
    }),
  );
  return { latest: () => latest };
}

async function openPlayer(browser: Browser, name: string, roomCode?: string) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  const server = watchServer(page);
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
  return { page, server };
}

/** Two players ready up, walk to the gate and go through it. Returns what each was sent. */
async function enterRun(browser: Browser, label: string, testInfo: { outputPath(name: string): string }, withGuest: boolean) {
  const { page: host, server: hostServer } = await openPlayer(browser, "Maya");
  const room = host.locator(".hud__stat", { hasText: "Room:" }).locator("span");
  await expect(room).toHaveText(/^[A-Z0-9]{6}$/);
  const joined = withGuest ? await openPlayer(browser, "Theo", (await room.textContent()) ?? "") : null;
  const guest = joined?.page ?? host;
  if (withGuest) await expect(host.locator(".hud__frames")).toContainText("Theo", { timeout: 15_000 });
  const seen = { host: hostServer, guest: joined?.server ?? hostServer };

  // The guest only readies up; the host walks to the gate for the party.
  for (const page of new Set([host, guest])) await page.getByRole("button", { name: "Ready" }).click();
  for (const waypoint of TO_GATE) await walkTo(host, waypoint, 0.8);
  await walkTo(host, GATE, 1);
  await expect(async () => {
    await host.keyboard.press("e");
    expect(seen.host.latest()?.location).toBe("dungeon");
  }).toPass({ timeout: 20_000 });
  // The entrance is discovered a tick after arrival, on each client.
  for (const server of new Set([seen.host, seen.guest])) {
    await expect(async () => expect(server.latest()?.dungeon.rooms.length).toBeGreaterThan(0)).toPass({ timeout: 10_000 });
  }

  await host.screenshot({ path: testInfo.outputPath(`delve-${label}-host.png`) });
  await guest.screenshot({ path: testInfo.outputPath(`delve-${label}-guest.png`) });
  const result = { host: seen.host.latest()!, guest: seen.guest.latest()! };
  await host.context().close();
  if (withGuest) await guest.context().close();
  return result;
}

test.describe("Delve run", () => {
  test("two clients enter a generated run, and each entry from the hub is a different layout", async ({ browser }, testInfo) => {
    test.setTimeout(240_000);
    const first = await enterRun(browser, "party-of-two", testInfo, true);
    const second = await enterRun(browser, "solo", testInfo, false);

    for (const run of [first, second]) {
      // A snapshot lists only the rooms a player has discovered, which at the gate is the entrance.
      expect(run.host.dungeon.rooms.map((room) => room.kind)).toEqual(["entrance"]);
      // Both clients are told the same run.
      expect(run.guest.dungeon.rooms).toEqual(run.host.dungeon.rooms);
    }

    // Whether the exit is reachable is the server sweep's job (`generationSweep.test.ts`); here the
    // two entries must simply not be the same dungeon.
    expect(second.host.dungeon.rooms).not.toEqual(first.host.dungeon.rooms);
  });
});
