import { expect, test, type Page } from "@playwright/test";
import { trackContexts } from "./contexts.js";

type Sent = { type?: string; appearance?: Record<string, string> };

const CHOICE = { body: "girl", skinTone: "tan", hairStyle: "bun", hairColor: "ginger" };

/** Opens a page that records every message it sends and every player entry it is sent. */
async function openRecordedPage(page: Page, sent: Sent[], seen: Array<{ name: string; appearance: unknown }>) {
  await page.routeWebSocket(/:8080/, (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => {
      if (typeof message === "string") sent.push(JSON.parse(message) as Sent);
      server.send(message);
    });
    server.onMessage((message) => {
      if (typeof message === "string") {
        const parsed = JSON.parse(message) as { players?: Array<{ name: string; appearance: unknown }> };
        for (const player of parsed.players ?? []) seen.push({ name: player.name, appearance: player.appearance });
      }
      socket.send(message);
    });
  });
  await page.goto("/");
}

async function choose(page: Page, group: string, option: string) {
  await page.getByRole("radiogroup", { name: group }).getByRole("radio", { name: option, exact: true }).click();
}

const track = trackContexts();

test.describe("Character design screen", () => {
  test("designing a character sends exactly the selections and a teammate sees that look", async ({ browser }) => {
    test.setTimeout(60_000);
    const hostContext = track(await browser.newContext({ viewport: { width: 1280, height: 720 } }));
    const host = await hostContext.newPage();
    const hostSent: Sent[] = [];
    const hostSaw: Array<{ name: string; appearance: unknown }> = [];
    await openRecordedPage(host, hostSent, hostSaw);
    await host.getByPlaceholder("Your name").fill("Host");
    await host.getByRole("button", { name: "Create a new dungeon" }).click();
    await expect(host.getByRole("button", { name: "Enter the hub" })).toBeVisible();
    await host.getByRole("button", { name: "Enter the hub" }).click();
    await expect(host.locator(".hud__vitals")).toBeVisible();
    const roomCode = (await host.locator(".hud__stat", { hasText: "Room:" }).locator("span").textContent()) ?? "";

    const guestContext = track(await browser.newContext({ viewport: { width: 1280, height: 720 } }));
    const guest = await guestContext.newPage();
    const guestSent: Sent[] = [];
    await openRecordedPage(guest, guestSent, []);
    await guest.getByPlaceholder("Your name").fill("Maya");
    await guest.getByPlaceholder(/Room code/).fill(roomCode);
    await guest.getByRole("button", { name: "Join dungeon" }).click();

    await expect(guest.getByText(`Joining ${roomCode} · 2 of 4 here`)).toBeVisible();
    expect(guestSent.some((message) => message.type === "setAppearance")).toBe(false);

    await choose(guest, "Body", "Girl");
    await choose(guest, "Skin tone", "Tan");
    await choose(guest, "Hair style", "Bun");
    await choose(guest, "Hair colour", "Ginger");

    await guest.getByRole("button", { name: "Enter the hub" }).click();
    await expect(guest.getByRole("button", { name: "Enter the hub" })).toBeHidden();

    const payload = guestSent.filter((message) => message.type === "setAppearance");
    expect(payload).toHaveLength(1);
    expect(payload[0]!.appearance).toEqual(CHOICE);

    await expect.poll(() => hostSaw.some((p) => p.name === "Maya" && JSON.stringify(p.appearance) === JSON.stringify(CHOICE))).toBe(true);

    // The look is remembered: a fresh page for the same browser opens on it.
    const stored = await guest.evaluate<string | null>(`window.localStorage.getItem("dnd.lastLook")`);
    expect(JSON.parse(stored ?? "null")).toEqual(CHOICE);
  });

  test("every control works from the keyboard and the layout fits a phone", async ({ browser }) => {
    const context = track(await browser.newContext({ viewport: { width: 400, height: 800 } }));
    const page = await context.newPage();
    const saved = JSON.stringify({ body: "guy", skinTone: "porcelain", hairStyle: "crop", hairColor: "black" });
    await page.addInitScript(`window.localStorage.setItem("dnd.lastLook", ${JSON.stringify(saved)})`);
    await page.goto("/");
    await page.getByPlaceholder("Your name").fill("Kay");
    await page.getByRole("button", { name: "Create a new dungeon" }).click();

    const body = page.getByRole("radiogroup", { name: "Body" });
    await expect(body.getByRole("radio", { name: "Guy" })).toBeChecked();
    await expect(body.getByRole("radio", { name: "Guy" })).toBeFocused();

    await page.keyboard.press("ArrowRight");
    await expect(body.getByRole("radio", { name: "Girl" })).toBeChecked();
    await page.keyboard.press("ArrowLeft");
    await expect(body.getByRole("radio", { name: "Guy" })).toBeChecked();

    await page.keyboard.press("Tab");
    await expect(page.getByRole("radiogroup", { name: "Skin tone" }).getByRole("radio", { name: "Porcelain" })).toBeFocused();
    await page.keyboard.press("End");
    await expect(page.getByRole("radiogroup", { name: "Skin tone" }).getByRole("radio", { name: "Deep" })).toBeChecked();

    const walk = page.getByRole("button", { name: "Walk" });
    await walk.click();
    await expect(walk).toHaveAttribute("aria-pressed", "true");

    // R re-rolls the whole look; an arrow-key move would never reach the world behind the screen.
    await page.getByRole("button", { name: "Randomize (R)" }).focus();
    await page.keyboard.press("r");
    await expect(page.getByRole("radiogroup", { name: "Body" }).getByRole("radio", { checked: true })).toHaveCount(1);

    const overflow = await page.evaluate<number>(
      `(() => { const screen = document.querySelector(".design"); return screen.scrollWidth - screen.clientWidth; })()`,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test("Back leaves the dungeon and returns to the lobby", async ({ page }) => {
    await page.goto("/");
    await page.getByPlaceholder("Your name").fill("Kay");
    await page.getByRole("button", { name: "Create a new dungeon" }).click();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.getByRole("button", { name: "Join dungeon" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Enter the hub" })).toBeHidden();
  });
  test("renaming while designing refuses a clash, then shows the new name to a teammate", async ({ browser }) => {
    test.setTimeout(60_000);
    const hostContext = track(await browser.newContext({ viewport: { width: 1280, height: 720 } }));
    const host = await hostContext.newPage();
    await host.goto("/");
    await host.getByPlaceholder("Your name").fill("Host");
    await host.getByRole("button", { name: "Create a new dungeon" }).click();
    await host.getByRole("button", { name: "Enter the hub" }).click();
    await expect(host.locator(".hud__vitals")).toBeVisible();
    const roomCode = (await host.locator(".hud__stat", { hasText: "Room:" }).locator("span").textContent()) ?? "";

    const guestContext = track(await browser.newContext({ viewport: { width: 1280, height: 720 } }));
    const guest = await guestContext.newPage();
    const guestSent: Sent[] = [];
    await openRecordedPage(guest, guestSent, []);
    await guest.getByPlaceholder("Your name").fill("Maya");
    await guest.getByPlaceholder(/Room code/).fill(roomCode);
    await guest.getByRole("button", { name: "Join dungeon" }).click();

    const name = guest.getByRole("textbox", { name: "Name", exact: true });
    await expect(name).toHaveValue("Maya");
    const enter = guest.getByRole("button", { name: "Enter the hub" });

    // A teammate's name is refused, and the look is not locked in by the attempt.
    await name.fill("host");
    await enter.click();
    await expect(guest.locator(".design__error")).toContainText("already uses that name");
    await expect(enter).toBeEnabled();
    expect(guestSent.some((message) => message.type === "setAppearance")).toBe(false);
    await guest.screenshot({ path: "test-results/rename-clash-refused.png" });

    // Typing an "r" in the field must not reroll the look.
    await name.fill("");
    await name.pressSequentially("Mara");
    await guest.screenshot({ path: "test-results/rename-design-screen.png" });
    await name.press("Enter");
    await expect(guest.locator(".design")).toBeHidden();

    expect(guestSent.map((message) => message.type).filter((type) => type === "setName" || type === "setAppearance"))
      .toEqual(["setName", "setName", "setAppearance"]);
    await expect(host.locator(".hud__frame", { hasText: "Mara" })).toBeVisible();
    await host.screenshot({ path: "test-results/rename-host-party-frame.png" });
  });
});
