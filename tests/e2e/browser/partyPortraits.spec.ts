import { expect, test, type Browser } from "@playwright/test";
import { enterHub } from "./designScreen.js";
import { GAME_SOCKET } from "./ports.js";

/**
 * A teammate who joins but has not finished designing their character. There is no design screen
 * yet, so the guest's page holds its `setAppearance` back until the test lets it through, which is
 * the moment a real player would press confirm.
 */
const GUEST_LOOK = { body: "girl", skinTone: "deep", hairStyle: "bun", hairColor: "azure" } as const;

async function openPlayer(browser: Browser, errors: string[]) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  let held: (() => void) | null = null;
  let holding = false;
  await page.routeWebSocket(GAME_SOCKET, (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      if (typeof message !== "string") return server.send(message);
      const parsed = JSON.parse(message) as { type?: string };
      if (parsed.type !== "setAppearance") return server.send(message);
      const send = () => server.send(JSON.stringify({ ...parsed, appearance: GUEST_LOOK }));
      if (holding) held = send;
      else send();
    });
  });
  await page.goto("/");

  return {
    page,
    /** From now on, keep this player on the design screen. */
    holdAppearance() {
      holding = true;
    },
    /** The player confirms their character. */
    confirmAppearance() {
      holding = false;
      held?.();
      held = null;
    },
  };
}

test.describe("Party portraits", () => {
  test("a teammate shows as designing until they confirm, then with their portrait", async ({ browser }, testInfo) => {
    const errors: string[] = [];
    const host = await openPlayer(browser, errors);
    await host.page.getByPlaceholder("Your name").fill("Maya");
    await host.page.getByRole("button", { name: "Create a new dungeon" }).click();
    const room = host.page.locator(".hud__stat", { hasText: "Room:" }).locator("span");
    await expect(room).toHaveText(/^[A-Z0-9]{6}$/);
    const roomCode = (await room.textContent()) ?? "";
    await enterHub(host.page);

    const guest = await openPlayer(browser, errors);
    guest.holdAppearance();
    await guest.page.getByPlaceholder("Your name").fill("Sam");
    await guest.page.getByPlaceholder(/Room code/).fill(roomCode);
    await guest.page.getByRole("button", { name: "Join dungeon" }).click();
    // Confirming the design screen sends the look, which `holdAppearance` keeps back.
    await enterHub(guest.page);

    const frame = host.page.locator(".hud__frame", { hasText: "Sam" });
    await expect(frame).toHaveAttribute("data-state", "designing", { timeout: 15_000 });
    await expect(frame.locator(".hud__frame-caption")).toHaveText("Designing…");
    await expect(frame.locator(".hud__bar").first()).toBeHidden();
    await expect(host.page.locator(".hud__hub-status")).toContainText(
      "Waiting on Sam to finish designing a character.",
    );
    await host.page.waitForTimeout(300);
    await host.page.screenshot({ path: testInfo.outputPath("party-frame-designing.png") });

    guest.confirmAppearance();
    await expect(frame).toHaveAttribute("data-state", "waiting");
    await expect(frame.locator(".hud__frame-caption")).toBeHidden();
    await expect(frame.locator(".hud__bar").first()).toBeVisible();
    await expect(host.page.locator(".hud__hub-status")).toContainText("Waiting on Maya and Sam to ready up.");

    // The portrait is painted from the character sheet: some of its pixels are the guest's
    // azure hair, which a silhouette never is.
    const hasHair = await frame.locator("canvas.hud__frame-portrait").evaluate((element) => {
      // Typed by hand: the test project compiles without the DOM library.
      const canvas = element as unknown as {
        width: number;
        height: number;
        getContext(kind: "2d"): { getImageData(x: number, y: number, w: number, h: number): { data: ArrayLike<number> } };
      };
      const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      for (let offset = 0; offset < pixels.length; offset += 4) {
        // The azure ramp's mid step, #5279be.
        if (pixels[offset] === 0x52 && pixels[offset + 1] === 0x79 && pixels[offset + 2] === 0xbe) return true;
      }
      return false;
    });
    expect(hasHair).toBe(true);
    await host.page.screenshot({ path: testInfo.outputPath("party-frame-portrait.png") });
    await host.page.screenshot({
      path: testInfo.outputPath("party-frame-close-up.png"),
      clip: { x: 0, y: 60, width: 320, height: 180 },
    });

    expect(errors).toEqual([]);
    for (const player of [host, guest]) await player.page.context().close();
  });
});
