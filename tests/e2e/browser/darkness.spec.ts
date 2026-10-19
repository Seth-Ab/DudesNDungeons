import { expect, test, type Page } from "@playwright/test";
import { enterHub } from "./designScreen.js";

/**
 * Hub positions in world units: a Traveler's Torch on the Torch Supply counter at authored
 * (6, 5.3125), and the gate at (11, 1).
 */
const TORCH = { x: 25.5, y: 22.75 };
const GATE = { x: 45.5, y: 5.5 };
/** From the first spawn, west of the fountain, to the floor in front of the Torch Supply. */
const TO_TORCHES = [
  { x: 33.5, y: 29.5 },
  { x: 33.5, y: 25.5 },
];
/** From the Torch Supply, round the benches on the north of the plaza, to the gate road. */
const TO_GATE = [
  { x: 33.5, y: 25.5 },
  { x: 33.5, y: 17.5 },
  { x: 45.5, y: 17.5 },
];
/** Must match `pixelsPerWorldUnit` in `canvasRenderer.ts`. */
const PIXELS_PER_WORLD_UNIT = 32;
/** A pixel this dark or darker is the shade colour (6, 7, 10) at full opacity, not lit geometry. */
const BLACK_CHANNEL_MAX = 16;

interface Snapshot {
  location: "hub" | "dungeon";
  players: { id: string; position: { x: number; y: number }; carryingTorch: boolean }[];
  dungeon: {
    map: {
      id: string;
      reset: boolean;
      discovered: { x: number; y: number; tiles: string }[];
      lit: [number, number, number][];
    };
  };
}

/**
 * What this client has been told, read straight off its WebSocket: the latest snapshot, its own id,
 * and every tile discovered in the current world. Independent of the client's own state, so the
 * test checks the pixels against the server rather than against the code under test.
 */
function watchServer(page: Page) {
  const seen = { selfId: null as string | null, latest: null as Snapshot | null, discovered: new Set<string>() };

  page.on("websocket", (socket) =>
    socket.on("framereceived", ({ payload }) => {
      if (typeof payload !== "string") return;
      const message = JSON.parse(payload) as { type: string; playerId?: string } & Partial<Snapshot>;
      if (message.type === "sessionJoined") seen.selfId = message.playerId ?? null;
      if (message.type !== "stateSnapshot") return;

      const snapshot = message as unknown as Snapshot;
      if (snapshot.dungeon.map.reset) seen.discovered.clear();
      for (const run of snapshot.dungeon.map.discovered) {
        for (let offset = 0; offset < run.tiles.length; offset += 1) seen.discovered.add(`${run.x + offset},${run.y}`);
      }
      seen.latest = snapshot;
    }),
  );

  const self = () => seen.latest?.players.find((player) => player.id === seen.selfId) ?? null;
  return { seen, self };
}

async function position(page: Page): Promise<{ x: number; y: number }> {
  const text = (await page.getByText("Position:").textContent()) ?? "";
  const [x, y] = (text.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  if (x === undefined || y === undefined) throw new Error(`No position in "${text}"`);
  return { x, y };
}

/** Walks until the predicted position is within `reach` of `target`, steering by the debug readout. */
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

/** Every tile a snapshot's lit runs cover, as `"x,y"` keys. */
function litTiles(snapshot: Snapshot): Set<string> {
  const lit = new Set<string>();
  for (const [x, y, length] of snapshot.dungeon.map.lit) {
    for (let offset = 0; offset < length; offset += 1) lit.add(`${x + offset},${y}`);
  }
  return lit;
}

/**
 * Discovered tiles on screen that the latest snapshot did not light, and that are at least two tiles
 * from any lit one so the lightmap's smoothing cannot reach them.
 */
function rememberedOnScreen(
  discovered: ReadonlySet<string>,
  lit: ReadonlySet<string>,
  camera: { x: number; y: number },
): [number, number][] {
  const halfX = 1280 / 2 / PIXELS_PER_WORLD_UNIT - 1;
  const halfY = 720 / 2 / PIXELS_PER_WORLD_UNIT - 1;
  return [...discovered]
    .map((key) => key.split(",").map(Number) as [number, number])
    .filter(([x, y]) => Math.abs(x - camera.x) < halfX && Math.abs(y - camera.y) < halfY)
    .filter(([x, y]) => {
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) if (lit.has(`${x + dx},${y + dy}`)) return false;
      }
      return true;
    });
}

/**
 * Walks on through the generated dungeon, whose layout differs every run, until `done` holds. Each
 * leg holds one direction; one that ends no further from the start is walked back, so the next
 * direction sets out from further away.
 */
async function explore(page: Page, from: { x: number; y: number }, done: () => Promise<boolean>): Promise<void> {
  for (let leg = 0; leg < 48; leg += 1) {
    const key = ["d", "s", "a", "w"][leg % 4]!;
    const before = await position(page);
    await page.keyboard.down(key);
    await page.waitForTimeout(1200);
    await page.keyboard.up(key);
    // Stand still so the predicted camera and the server agree, then let a snapshot or two land.
    await page.waitForTimeout(300);
    if (await done()) return;

    const after = await position(page);
    if (Math.hypot(after.x - from.x, after.y - from.y) < Math.hypot(before.x - from.x, before.y - from.y)) {
      const back = { d: "a", a: "d", s: "w", w: "s" }[key]!;
      await page.keyboard.down(back);
      await page.waitForTimeout(1200);
      await page.keyboard.up(back);
    }
  }
  throw new Error("Never walked far enough from explored ground to leave it in the dark");
}

test.describe("Darkness", () => {
  test("an explored room the player has walked out of draws black on the canvas", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const { seen, self } = watchServer(page);

    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/?debug");
    await page.getByPlaceholder("Your name").fill("Maya");
    await page.getByRole("button", { name: "Create a new dungeon" }).click();
    await enterHub(page);
    await expect(page.locator(".hud__vitals")).toBeVisible();
    await expect(page.getByText("Position:")).toContainText(/\d+\.\d+, \d+\.\d+/);

    // A torch from the supply table, so the dungeon has a light that moves with the player. The
    // counter is solid: line up below the torch and walk into it.
    for (const waypoint of TO_TORCHES) await walkTo(page, waypoint, 0.6);
    await walkTo(page, { x: TORCH.x, y: TORCH.y + 1.75 }, 0.3);
    await page.keyboard.down("w");
    await page.waitForTimeout(400);
    await page.keyboard.up("w");
    await expect(async () => {
      await page.keyboard.press("f");
      expect(self()?.carryingTorch).toBe(true);
    }).toPass({ timeout: 10_000 });

    await page.getByRole("button", { name: "Ready" }).click();
    for (const waypoint of TO_GATE) await walkTo(page, waypoint, 0.6);
    await walkTo(page, GATE, 1);
    await expect(async () => {
      await page.keyboard.press("e");
      expect(seen.latest?.location).toBe("dungeon");
    }).toPass({ timeout: 15_000 });
    await expect(page.getByText("Position:")).toContainText(/\d+\.\d+, \d+\.\d+/);

    // Walk on until ground the player explored is on screen but out of every light.
    const spawn = await position(page);
    let camera = spawn;
    let remembered: [number, number][] = [];
    await explore(page, spawn, async () => {
      camera = await position(page);
      remembered = rememberedOnScreen(seen.discovered, litTiles(seen.latest!), camera);
      return remembered.length >= 40;
    });

    await page.screenshot({ path: testInfo.outputPath("remembered-room-dark.png") });
    const pixels = await page.locator("canvas.game-canvas").evaluate(
      (element, { tiles, camera, scale }) => {
        // Typed by hand: the test project compiles without the DOM library.
        const canvas = element as unknown as {
          width: number;
          clientWidth: number;
          clientHeight: number;
          getContext(kind: "2d"): { getImageData(x: number, y: number, w: number, h: number): { data: ArrayLike<number> } };
        };
        const context = canvas.getContext("2d");
        const ratio = canvas.width / canvas.clientWidth;
        return tiles.map(([x, y]) => {
          const screenX = Math.round((canvas.clientWidth / 2 + (x - camera.x) * scale) * ratio);
          const screenY = Math.round((canvas.clientHeight / 2 + (y - camera.y) * scale) * ratio);
          const { data } = context.getImageData(screenX, screenY, 1, 1);
          return { tile: `${x},${y}`, rgb: [data[0]!, data[1]!, data[2]!] };
        });
      },
      { tiles: remembered, camera, scale: PIXELS_PER_WORLD_UNIT },
    );

    const bright = pixels.filter(({ rgb }) => Math.max(...rgb) > BLACK_CHANNEL_MAX);
    expect(bright, "remembered tiles drawn brighter than black").toEqual([]);
  });
});
