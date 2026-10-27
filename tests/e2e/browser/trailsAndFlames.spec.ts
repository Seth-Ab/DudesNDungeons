import { expect, test, type Browser, type Page } from "@playwright/test";
import { trackContexts } from "./contexts.js";
import { enterHub } from "./designScreen.js";
import { position, walkTo } from "./walk.js";
import { GAME_SOCKET } from "./ports.js";

const track = trackContexts();

/** The Traveler's Torches on the Torch Supply counter, a pace apart: one each. */
const TORCH_Y = 22.75;
const TORCH_X = { Maya: 25.5, Sam: 28.5 } as const;
const NORTH_ROAD_Y = 14;
const EAST_ROW_Y = 30;
const EAST_COLUMN_X = 74;

/**
 * What each player is shown wearing. A new profile owns no trail or flame and has no coin to buy
 * one, and the server reads profiles only at start, so the spec cannot equip them for real: each
 * client's socket dresses the other player in the snapshots it receives. The server's half, buying
 * and equipping, is covered by `tests/server/wardrobe.test.ts`; this covers the renderer drawing a
 * teammate's trail and flame from real snapshots of real swings and torches.
 */
const WORN = {
  Maya: { trail: "frost-shards", flame: "spirit-flame" },
  Sam: { trail: "petal-drift", flame: "witchfire" },
} as const;
type Name = keyof typeof WORN;

/** A colour only each trail draws, and each flame's swapped glow colour and halo tint. */
const TRAIL_COLOUR = { "frost-shards": "#bcd6f6", "petal-drift": "#f2a6bc" } as const;
const FLAME_COLOUR = { "spirit-flame": "7fb0f0", witchfire: "8ce07a" } as const;
const FLAME_HALO = { "spirit-flame": "rgba(127, 176, 240, 0.22)", witchfire: "rgba(140, 224, 122, 0.22)" } as const;

/**
 * Records what the game canvas fills, which gradient colours are used, and the colours of every
 * small sprite recoloured through `putImageData`. A string because the test project compiles
 * without the DOM library.
 */
const RECORD_DRAWING = `(() => {
  const drawn = { fills: new Set(), stops: new Set(), sprites: new Set() };
  window.__drawn = drawn;
  const proto = CanvasRenderingContext2D.prototype;
  const fillRect = proto.fillRect;
  proto.fillRect = function (...args) {
    if (this.canvas.classList.contains("game-canvas") && typeof this.fillStyle === "string") drawn.fills.add(this.fillStyle);
    return fillRect.apply(this, args);
  };
  const putImageData = proto.putImageData;
  proto.putImageData = function (image, ...rest) {
    if (image.width <= 32 && image.height <= 32) {
      for (let offset = 0; offset < image.data.length; offset += 4) {
        if (image.data[offset + 3] === 0) continue;
        const hex = ((image.data[offset] << 16) | (image.data[offset + 1] << 8) | image.data[offset + 2]).toString(16).padStart(6, "0");
        drawn.sprites.add(hex);
      }
    }
    return putImageData.call(this, image, ...rest);
  };
  const addColorStop = CanvasGradient.prototype.addColorStop;
  CanvasGradient.prototype.addColorStop = function (offset, colour) {
    drawn.stops.add(colour);
    return addColorStop.call(this, offset, colour);
  };
})()`;

async function openPlayer(browser: Browser, name: Name): Promise<Page> {
  const other: Name = name === "Maya" ? "Sam" : "Maya";
  const context = track(await browser.newContext({ viewport: { width: 1280, height: 720 } }));
  await context.addInitScript(RECORD_DRAWING);
  const page = await context.newPage();
  await page.routeWebSocket(GAME_SOCKET, (socket) => {
    const server = socket.connectToServer();
    server.onMessage((message) => {
      if (typeof message !== "string" || !message.includes('"players"')) {
        socket.send(message);
        return;
      }
      const parsed = JSON.parse(message) as { players?: { name: string; cosmetics: Record<string, string | null> }[] };
      for (const player of parsed.players ?? []) {
        if (player.name === other) player.cosmetics = { ...player.cosmetics, ...WORN[other] };
      }
      socket.send(JSON.stringify(parsed));
    });
  });
  await page.goto("/?debug");
  await page.getByPlaceholder("Your name").fill(name);
  return page;
}

/** From either spawn beside the fountain to the floor below the Torch Supply, then a torch. */
async function takeTorch(page: Page, torchX: number): Promise<void> {
  const start = await position(page);
  const route =
    start.x > 44
      ? [
          { x: start.x, y: EAST_ROW_Y },
          { x: EAST_COLUMN_X, y: EAST_ROW_Y },
          { x: EAST_COLUMN_X, y: NORTH_ROAD_Y },
          { x: 33.5, y: NORTH_ROAD_Y },
        ]
      : [{ x: 33.5, y: start.y }];
  for (const waypoint of [...route, { x: 33.5, y: 25.5 }, { x: torchX, y: TORCH_Y + 1.75 }]) {
    await walkTo(page, waypoint, 0.4);
  }
  // The counter is solid: lean into it so the torches are in reach, then pick one up.
  await page.keyboard.down("w");
  await page.waitForTimeout(400);
  await page.keyboard.up("w");
  await expect(async () => {
    await page.keyboard.press("f");
    await expect(page.locator(".hud__torch")).toHaveClass(/hud__torch--lit/, { timeout: 1000 });
  }).toPass({ timeout: 10_000 });
}

async function drawn(page: Page): Promise<{ fills: string[]; stops: string[]; sprites: string[] }> {
  return page.evaluate(`(() => {
    const drawn = window.__drawn;
    return { fills: [...drawn.fills], stops: [...drawn.stops], sprites: [...drawn.sprites] };
  })()`);
}

test.describe("Weapon trails and torch flames", () => {
  test("each player sees the other's trail on swings and flame on their torch", async ({ browser }, testInfo) => {
    test.setTimeout(150_000);

    const host = await openPlayer(browser, "Maya");
    await host.getByRole("button", { name: "Create a new dungeon" }).click();
    const room = host.locator(".hud__stat", { hasText: "Room:" }).locator("span");
    await expect(room).toHaveText(/^[A-Z0-9]{6}$/);
    const roomCode = (await room.textContent()) ?? "";
    await enterHub(host);

    const guest = await openPlayer(browser, "Sam");
    await guest.getByPlaceholder(/Room code/).fill(roomCode);
    await guest.getByRole("button", { name: "Join dungeon" }).click();
    await enterHub(guest);

    await takeTorch(host, TORCH_X.Maya);
    await takeTorch(guest, TORCH_X.Sam);

    // Swing until the teammate has drawn this player's trail; each swing lasts a fraction of a second.
    for (const [page, watcher, name] of [
      [host, guest, "Maya"],
      [guest, host, "Sam"],
    ] as const) {
      const colour = TRAIL_COLOUR[WORN[name].trail];
      await expect(async () => {
        await page.keyboard.press(" ");
        expect((await drawn(watcher)).fills).toContain(colour);
      }).toPass({ timeout: 15_000 });
      // A player's own swing is drawn with no trail: nobody dressed them on their own socket.
      expect((await drawn(page)).fills).not.toContain(colour);
    }

    // Each sees the other's torch in the other's flame, and its halo, and never their own.
    for (const [watcher, name, self] of [
      [guest, "Maya", "Sam"],
      [host, "Sam", "Maya"],
    ] as const) {
      const flame = WORN[name].flame;
      await expect.poll(async () => (await drawn(watcher)).sprites).toContain(FLAME_COLOUR[flame]);
      await expect.poll(async () => (await drawn(watcher)).stops).toContain(FLAME_HALO[flame]);
      expect((await drawn(watcher)).stops).not.toContain(FLAME_HALO[WORN[self].flame]);
    }

    await host.screenshot({ path: testInfo.outputPath("host-sees-guest.png") });
    await guest.screenshot({ path: testInfo.outputPath("guest-sees-host.png") });
  });
});
