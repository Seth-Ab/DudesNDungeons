import { expect, test, type Browser, type Page } from "@playwright/test";
import { enterHub } from "./designScreen.js";

/** World position of the hub's first training dummy: authored tile (19, 3) in the training yard. */
const DUMMY = { x: 77.5, y: 13.5 };
const DUMMY_ID = "b1111111-1111-4111-8111-111111111111";
/** Where to stand to swing east at it: a body's length to its west, inside unarmed reach. */
const SWING_SPOT = { x: DUMMY.x - 0.7, y: DUMMY.y };
/** World position of the hub's Rusted Sword, on the Weapons counter: authored (15.125, 5.3125). */
const SWORD = { x: 62, y: 22.75 };
/** From the first spawn, west of the fountain, up the plaza's west side to the dummy's row. */
const SPAWN_TO_DUMMY_ROW = [
  { x: 33.5, y: 29.5 },
  { x: 33.5, y: 13.5 },
];
/** From the dummy's row, down the plaza's east side to the floor in front of the Weapons stall. */
const DUMMY_ROW_TO_WEAPONS = [
  { x: 57.5, y: 13.5 },
  { x: 57.5, y: 25.5 },
];
/** And back again, round the Weapons stall. */
const WEAPONS_TO_DUMMY_ROW = [
  { x: 57.5, y: 25.5 },
  { x: 57.5, y: 13.5 },
];

interface Readout {
  recentDamage: number;
  dps: number;
  attackers: { playerId: string; recentDamage: number; dps: number }[];
}

/**
 * Every snapshot's readout for the dummy, by tick, as this page received it off the socket. The
 * plate is canvas-drawn, so this is how the test sees the numbers the client was given to draw.
 */
function recordReadouts(page: Page): Map<number, Readout> {
  const byTick = new Map<number, Readout>();
  page.on("websocket", (socket) => {
    socket.on("framereceived", ({ payload }) => {
      if (typeof payload !== "string" || !payload.includes('"stateSnapshot"')) return;
      const message = JSON.parse(payload) as {
        tick: number;
        dungeon: { dummies: ({ id: string } & Readout)[] };
      };
      const dummy = message.dungeon.dummies.find((candidate) => candidate.id === DUMMY_ID);
      if (dummy) {
        byTick.set(message.tick, {
          recentDamage: dummy.recentDamage,
          dps: dummy.dps,
          attackers: dummy.attackers,
        });
      }
    });
  });
  return byTick;
}

/**
 * How many landed hits this page has been sent, counted off the socket. The action feed is no
 * witness for this: it shows a repeated line once, then lets it expire, so a second identical hit
 * can go unseen.
 */
function countHits(page: Page): { count: number } {
  const hits = { count: 0 };
  page.on("websocket", (socket) => {
    socket.on("framereceived", ({ payload }) => {
      if (typeof payload !== "string" || !payload.includes('"attackResolved"')) return;
      const message = JSON.parse(payload) as { type?: string; damage?: number };
      if (message.type === "attackResolved" && (message.damage ?? 0) > 0) hits.count += 1;
    });
  });
  return hits;
}

async function openPlayer(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  await page.goto("/?debug");
  return page;
}

async function position(page: Page): Promise<{ x: number; y: number }> {
  const text = (await page.getByText("Position:").textContent()) ?? "";
  const [x, y] = (text.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  if (x === undefined || y === undefined) throw new Error(`No position in "${text}"`);
  return { x, y };
}

/** Steers by the debug readout, as `hubSword.spec.ts` does, so a slow machine still arrives. */
async function walkTo(page: Page, target: { x: number; y: number }, reach: number): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const at = await position(page);
    const dx = target.x - at.x;
    const dy = target.y - at.y;
    if (Math.hypot(dx, dy) <= reach) return;

    const key = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? "d" : "a") : dy > 0 ? "s" : "w";
    await page.keyboard.down(key);
    await page.waitForTimeout(Math.max(Math.abs(dx), Math.abs(dy)) > 2 ? 200 : 40);
    await page.keyboard.up(key);
  }
  throw new Error(`Never reached ${JSON.stringify(target)}`);
}

/**
 * Lines up west of the dummy, facing it, and swings until the server reports a hit. `route`
 * reaches the dummy's row; the walk then runs east along it, north of the teammate watching from
 * the yard. Within 0.4 of the spot is inside unarmed reach and the arc facing east.
 */
async function hitDummy(
  page: Page,
  hits: { count: number },
  route: readonly { x: number; y: number }[],
): Promise<void> {
  for (const waypoint of route) await walkTo(page, waypoint, 0.6);
  await walkTo(page, SWING_SPOT, 0.4);
  const before = hits.count;
  await expect(async () => {
    // The swing goes the way the keys are held, falling back to the facing the server last echoed,
    // which lags the client. Holding east through the swing aims it without waiting on that echo.
    await page.keyboard.down("d");
    await page.waitForTimeout(40);
    await page.keyboard.press(" ");
    await page.keyboard.up("d");
    await expect.poll(() => hits.count, { timeout: 2000 }).toBeGreaterThan(before);
  }).toPass({ timeout: 20_000 });
}

/** The latest tick both pages received a readout for, with what each was sent. */
function sharedReadout(host: Map<number, Readout>, guest: Map<number, Readout>) {
  const ticks = [...host.keys()].filter((tick) => guest.has(tick)).sort((a, b) => b - a);
  const tick = ticks[0];
  return tick === undefined ? null : { host: host.get(tick)!, guest: guest.get(tick)! };
}

test.describe("Training dummies", () => {
  test("a player hits a hub dummy unarmed and with the Rusted Sword, and a teammate sees the same readout", async ({
    browser,
  }, testInfo) => {
    // Two clients, two walks across the hub, and a detour for the sword.
    test.setTimeout(120_000);
    const host = await openPlayer(browser);
    const hostReadouts = recordReadouts(host);
    const hostHits = countHits(host);
    await host.getByPlaceholder("Your name").fill("Maya");
    await host.getByRole("button", { name: "Create a new dungeon" }).click();
    await enterHub(host);
    const room = host.locator(".hud__stat", { hasText: "Room:" }).locator("span");
    await expect(room).toHaveText(/^[A-Z0-9]{6}$/);
    const roomCode = (await room.textContent()) ?? "";

    const guest = await openPlayer(browser);
    const guestReadouts = recordReadouts(guest);
    const guestHits = countHits(guest);
    await guest.getByPlaceholder("Your name").fill("Theo");
    await guest.getByPlaceholder(/Room code/).fill(roomCode);
    await guest.getByRole("button", { name: "Join dungeon" }).click();
    await enterHub(guest);
    await expect(guest.locator(".hud__vitals")).toBeVisible();
    await expect(host.locator(".hud__frames")).toContainText("Theo", { timeout: 15_000 });
    await expect(host.getByText("Position:")).toContainText(/\d+\.\d+, \d+\.\d+/);
    // The guest watches from just south of the dummy, off the host's path along the dummy's row.
    await expect(guest.getByText("Position:")).toContainText(/\d+\.\d+, \d+\.\d+/);
    await walkTo(guest, { x: DUMMY.x, y: (await position(guest)).y }, 0.6);
    await walkTo(guest, { x: DUMMY.x, y: DUMMY.y + 4 }, 0.6);

    // Unarmed.
    await hitDummy(host, hostHits, SPAWN_TO_DUMMY_ROW);
    // The guest is sent the same attackResolved, so it sees the same hit.
    await expect.poll(() => guestHits.count).toBeGreaterThan(0);
    await host.screenshot({ path: testInfo.outputPath("dummy-unarmed-host.png") });

    // With the Rusted Sword in hand.
    for (const waypoint of DUMMY_ROW_TO_WEAPONS) await walkTo(host, waypoint, 0.6);
    // The counter is solid: line up below the sword and walk into it.
    await walkTo(host, { x: SWORD.x, y: SWORD.y + 1.75 }, 0.3);
    await host.keyboard.down("w");
    await host.waitForTimeout(400);
    await host.keyboard.up("w");
    await expect(host.locator(".hud__prompt", { hasText: "Pick up Rusted Sword" })).toBeVisible();
    await expect(async () => {
      await host.keyboard.press("f");
      await expect(host.locator(".hud__slot--held")).toHaveAttribute("aria-label", /Rusted Sword/, {
        timeout: 1000,
      });
    }).toPass({ timeout: 10_000 });
    await hitDummy(host, hostHits, WEAPONS_TO_DUMMY_ROW);
    // A second blow after the cooldown, so the window holds at least two sword hits whatever the
    // walk back from the sword cost the unarmed one.
    await host.waitForTimeout(600);
    await host.keyboard.press(" ");

    // Both clients are sent one readout for the same tick, and it counts the host's hits.
    await expect
      .poll(() => sharedReadout(hostReadouts, guestReadouts)?.host.recentDamage ?? 0, { timeout: 5000 })
      .toBeGreaterThanOrEqual(12);
    const shared = sharedReadout(hostReadouts, guestReadouts);
    expect(shared?.guest).toEqual(shared?.host);
    expect(shared?.host.attackers).toHaveLength(1);
    expect(shared?.host.dps).toBeGreaterThan(0);

    await host.screenshot({ path: testInfo.outputPath("dummy-sword-host.png") });
    await guest.screenshot({ path: testInfo.outputPath("dummy-sword-guest.png") });
  });
});
