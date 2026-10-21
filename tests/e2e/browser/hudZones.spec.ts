import { expect, test, type Browser, type Page } from "@playwright/test";
import { trackContexts } from "./contexts.js";
import { enterHub } from "./designScreen.js";
import { walkTo } from "./walk.js";

/**
 * The Torch & Tally HUD's fixed zones: every module keeps its corner or edge at any window size,
 * none covers another or the canvas centre, and the hub's name plates are never drawn under one.
 * The density levels, the faded state and the touch layout are checked against the same zones.
 */

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

type Zone = "top-left" | "top-centre" | "top-right" | "bottom-left" | "bottom-centre" | "bottom-right";

/** Each module the HUD keeps on screen, and the zone it is pinned to. */
const MODULES: { name: string; selector: string; zone: Zone }[] = [
  { name: "key hints", selector: ".hud__panel--hints", zone: "top-left" },
  { name: "party frames", selector: ".hud__frames", zone: "top-left" },
  { name: "notice stack", selector: ".hud__notices", zone: "top-centre" },
  { name: "minimap corner", selector: ".hud__corner", zone: "top-right" },
  { name: "self frame", selector: ".hud__panel--party", zone: "bottom-left" },
  { name: "hotbar", selector: ".hud__hotbar", zone: "bottom-centre" },
  // Touch only: absent on a fine pointer, where the hotbar and prompt carry the keys.
  { name: "action buttons", selector: ".hud__panel--actions", zone: "bottom-right" },
];

const SIZES = [
  { name: "wide", width: 1280, height: 720 },
  { name: "narrow", width: 800, height: 600 },
] as const;

/** Every corner and edge module sits 0.5rem in from the viewport. */
const INSET = 8;

/**
 * Hub spots with name plates in range, from the first spawn west of the fountain up round its north
 * side: the stall and board plates there sit off the top and left edges, so they are clamped into
 * the area the HUD leaves free.
 */
const PLATE_SPOTS = [
  { x: 33.5, y: 29.5 },
  { x: 33.5, y: 17.5 },
  { x: 57.5, y: 17.5 },
];

/**
 * Records the hub name plates the renderer draws, one frame at a time. A plate is the 26px-high,
 * 6px-round panel `drawPropLabels` draws behind each name; nothing else on the game canvas has
 * that shape. A string because the test project compiles without the DOM library.
 */
const RECORD_PLATES = `(() => {
  const proto = CanvasRenderingContext2D.prototype;
  const roundRect = proto.roundRect;
  let frame = [];
  window.__namePlates = [];
  proto.roundRect = function (x, y, width, height, radius) {
    if (radius === 6 && height === 26 && this.canvas.classList.contains("game-canvas")) {
      frame.push({ x, y, width, height });
    }
    return roundRect.apply(this, arguments);
  };
  const tick = () => {
    window.__namePlates = frame;
    frame = [];
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})()`;

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** The boxes of the modules on screen now, by name. A hidden module has none. */
async function visibleModules(page: Page): Promise<{ name: string; zone: Zone; box: Box }[]> {
  const found: { name: string; zone: Zone; box: Box }[] = [];
  for (const { name, selector, zone } of MODULES) {
    const locator = page.locator(selector);
    if (!(await locator.isVisible())) continue;
    const box = await locator.boundingBox();
    if (box && box.width > 0 && box.height > 0) found.push({ name, zone, box });
  }
  return found;
}

/** Each module lies wholly inside the viewport, against its zone's edges, and covers no other. */
async function expectZones(page: Page, label: string): Promise<{ name: string; zone: Zone; box: Box }[]> {
  const viewport = page.viewportSize()!;
  const modules = await visibleModules(page);
  for (const { name, zone, box } of modules) {
    const what = `${name} at ${label}`;
    expect(box.x, what).toBeGreaterThanOrEqual(0);
    expect(box.y, what).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, what).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height, what).toBeLessThanOrEqual(viewport.height);

    const [vertical, horizontal] = zone.split("-") as ["top" | "bottom", "left" | "centre" | "right"];
    // The minimap corner runs past the middle on a short window, so a top module is held to its
    // half by the overlap check below rather than by the midline.
    if (vertical === "top") {
      expect(box.y, what).toBeLessThan(viewport.height / 2);
    } else {
      expect(box.y + box.height, what).toBeCloseTo(viewport.height - INSET, 0);
      expect(box.y, what).toBeGreaterThanOrEqual(viewport.height / 2);
    }
    if (horizontal === "left") {
      expect(box.x, what).toBeCloseTo(INSET, 0);
      expect(box.x + box.width, what).toBeLessThanOrEqual(viewport.width / 2);
    } else if (horizontal === "right") {
      expect(box.x + box.width, what).toBeCloseTo(viewport.width - INSET, 0);
      expect(box.x, what).toBeGreaterThanOrEqual(viewport.width / 2);
    } else {
      expect(box.x + box.width / 2, what).toBeCloseTo(viewport.width / 2, 0);
    }
  }
  // The top-left zone stacks the party frames under the key hints; the other top zones hold one.
  for (const module of modules.filter((candidate) => candidate.zone.startsWith("top"))) {
    if (module.name === "party frames") continue;
    expect(module.box.y, `${module.name} at ${label}`).toBeCloseTo(INSET, 0);
  }

  for (const [index, a] of modules.entries()) {
    for (const b of modules.slice(index + 1)) {
      expect(overlaps(a.box, b.box), `${a.name} overlaps ${b.name} at ${label}`).toBe(false);
    }
  }
  return modules;
}

/** A trial click fails if a HUD element intercepts the pointer at the canvas centre. */
async function expectCentreClickable(page: Page): Promise<void> {
  const viewport = page.viewportSize()!;
  await page.locator("canvas.game-canvas").click({
    position: { x: viewport.width / 2, y: viewport.height / 2 },
    trial: true,
  });
}

/** The name plates drawn in the latest full frame, after the renderer re-measures the HUD. */
async function namePlates(page: Page): Promise<Box[]> {
  // The safe area is re-measured every 250 ms and on a resize; wait out one measure and a frame.
  await page.waitForTimeout(400);
  return page.evaluate<Box[]>(`window.__namePlates`);
}

async function openPlayer(
  browser: Browser,
  track: ReturnType<typeof trackContexts>,
  options: { hasTouch?: boolean; url?: string; initScript?: string } = {},
): Promise<Page> {
  const context = track(
    await browser.newContext({ viewport: { width: 1280, height: 720 }, hasTouch: options.hasTouch ?? false }),
  );
  const page = await context.newPage();
  if (options.initScript) await page.addInitScript(options.initScript);
  await page.goto(options.url ?? "/");
  return page;
}

async function hostRoom(page: Page): Promise<string> {
  await page.getByPlaceholder("Your name").fill("Maya");
  await page.getByRole("button", { name: "Create a new dungeon" }).click();
  const room = page.locator(".hud__stat", { hasText: "Room:" }).locator("span");
  await expect(room).toHaveText(/^[A-Z0-9]{6}$/);
  const code = (await room.textContent()) ?? "";
  await enterHub(page);
  await expect(page.locator(".hud__vitals")).toBeVisible();
  return code;
}

async function joinRoom(page: Page, code: string): Promise<void> {
  await page.getByPlaceholder("Your name").fill("Noor");
  await page.getByPlaceholder(/Room code/).fill(code);
  await page.getByRole("button", { name: "Join dungeon" }).click();
  await enterHub(page);
}

/** Stores HUD settings before the page loads, as the Controls menu would have saved them. */
async function presetHudSettings(page: Page, settings: Record<string, unknown>): Promise<void> {
  await page.addInitScript(
    `window.localStorage.setItem("dnd.hudSettings", ${JSON.stringify(JSON.stringify(settings))})`,
  );
}

test.describe("HUD zones", () => {
  const track = trackContexts();

  test("every module keeps its zone at two window sizes, clear of the others, the canvas centre and the name plates", async ({
    browser,
  }, testInfo) => {
    test.setTimeout(120_000);
    const host = await openPlayer(browser, track, { url: "/?debug", initScript: RECORD_PLATES });
    const code = await hostRoom(host);
    await joinRoom(await openPlayer(browser, track), code);
    await expect(host.locator(".hud__frame")).toHaveCount(1);
    await expect(host.locator(".hud__hub-status")).toBeVisible();

    for (const size of SIZES) {
      await host.setViewportSize(size);
      const modules = await expectZones(host, size.name);
      // A fine pointer has no action buttons; every other module is on screen in the hub.
      expect(modules.map((module) => module.name)).toEqual(
        MODULES.filter((module) => module.name !== "action buttons").map((module) => module.name),
      );
      await expectCentreClickable(host);
      await host.screenshot({ path: testInfo.outputPath(`hud-zones-${size.name}.png`) });
    }

    let drawn = 0;
    for (const spot of PLATE_SPOTS) {
      await host.setViewportSize(SIZES[0]);
      await walkTo(host, spot, 0.6);
      for (const size of SIZES) {
        await host.setViewportSize(size);
        const plates = await namePlates(host);
        const modules = await visibleModules(host);
        drawn += plates.length;
        for (const plate of plates) {
          for (const module of modules) {
            expect(
              overlaps(plate, module.box),
              `plate at ${Math.round(plate.x)},${Math.round(plate.y)} under the ${module.name} at ${size.name}`,
            ).toBe(false);
          }
        }
      }
    }
    // The check means something only if plates were drawn, some of them clamped clear of the HUD.
    expect(drawn).toBeGreaterThan(0);
  });

  for (const density of ["full", "calm", "minimal"] as const) {
    test(`at ${density} density the faded state hides no warning and keeps non-colour cues`, async ({ page }) => {
      // Reduced motion makes the fade instant, and the fake clock jumps the quiet period: no waits.
      await presetHudSettings(page, { reducedMotion: true, uiScale: 1, density });
      await page.clock.install();
      const lowHealth = { on: false };
      // Every snapshot reports the player at 10 health, below the low-health line, as damage would.
      await page.routeWebSocket(/^wss?:\/\//, (socket) => {
        const server = socket.connectToServer();
        socket.onMessage((message) => server.send(message));
        server.onMessage((message) => {
          if (typeof message !== "string") return socket.send(message);
          const parsed = JSON.parse(message) as { type?: string; players?: { health: number }[] };
          if (parsed.type === "stateSnapshot" && lowHealth.on && parsed.players) {
            for (const player of parsed.players) player.health = 10;
            return socket.send(JSON.stringify(parsed));
          }
          socket.send(message);
        });
      });
      await page.setViewportSize(SIZES[0]);
      await page.goto("/");
      await hostRoom(page);
      await expect(page.locator("html")).toHaveAttribute("data-hud-density", density);

      await page.clock.fastForward(5000);
      const hotbar = page.locator(".hud__hotbar");
      const expected = { full: "1", calm: "0.55", minimal: "0.35" }[density];
      await expect(hotbar).toHaveAttribute("data-faded", String(density !== "full"));
      await expect(hotbar).toHaveCSS("opacity", expected);
      // Faded or not, the modules stay in their zones.
      await expectZones(page, `${density} density`);

      // The notice stack carries the gate banner and every warning toast, and it never fades.
      const notices = page.locator(".hud__notices");
      await expect(notices).toHaveCSS("opacity", "1");
      await expect(page.locator(".hud__hub-status")).toContainText("Waiting on Maya");

      // Each module still reads without colour: glyphs, text and key letters stay drawn.
      const glyphs = await page.locator(".hud__vitals .hud__bar-label").allTextContents();
      expect(glyphs.every((glyph) => glyph.trim() !== "")).toBe(true);
      expect(new Set(glyphs).size).toBe(glyphs.length);
      await expect(page.locator(".hud__mic")).toHaveText("Mic off");
      await expect(page.locator(".hud__hub-pip").first()).toHaveText("○");
      await expect(page.locator(".hud__minimap-north")).toHaveText("N");
      await expect(page.locator(".hud__minimap-room")).toHaveText("Hub");
      for (const key of await page.locator(".hud__hotbar .hud__slot-key").allTextContents()) {
        expect(key.trim()).not.toBe("");
      }
      await expect(page.locator(".hud__hint--camp")).toBeVisible();
      if (density === "minimal") {
        await expect(page.locator(".hud__hint:not(.hud__hint--camp)").first()).toBeHidden();
        // The digits hide, but their spoken text equivalent stays.
        await expect(page.locator(".hud__vitals .hud__bar--health")).toHaveAttribute("aria-label", /^Health \d+ of \d+$/);
      } else {
        await expect(page.locator(".hud__hint:not(.hud__hint--camp)").first()).toBeVisible();
        await expect(page.locator(".hud__vitals .hud__bar-value--inside")).toHaveText(/^\d+\/\d+$/);
      }

      // Low health pins the self frame lit at every level, with a mark and a spoken "low".
      const selfFrame = page.locator(".hud__panel--party");
      lowHealth.on = true;
      await expect(page.locator(".hud__vitals .hud__bar--health")).toHaveAttribute("aria-label", /, low$/);
      await page.clock.fastForward(5000);
      await expect(selfFrame).toHaveAttribute("data-faded", "false");
      await expect(selfFrame).toHaveCSS("opacity", "1");
      await expect(page.locator(".hud__vitals")).toContainText("!");
      // The quiet modules beside it still fade as before.
      await expect(hotbar).toHaveCSS("opacity", expected);
    });
  }

  for (const size of SIZES) {
    test(`a coarse pointer shows Attack and Emote in their own corner at the ${size.name} size`, async ({
      browser,
    }, testInfo) => {
      const page = await openPlayer(browser, track, { hasTouch: true });
      await page.setViewportSize(size);
      await hostRoom(page);
      await expect(page.getByRole("button", { name: "Attack", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Emote", exact: true })).toBeVisible();

      // `expectZones` puts the panel bottom-right and checks it covers no other module, which
      // includes the self frame, the hotbar and the minimap corner.
      const modules = await expectZones(page, `touch ${size.name}`);
      const names = modules.map((module) => module.name);
      for (const name of ["action buttons", "self frame", "hotbar", "minimap corner"]) expect(names).toContain(name);
      await expectCentreClickable(page);
      await page.screenshot({ path: testInfo.outputPath(`hud-zones-touch-${size.name}.png`) });
    });
  }
});
