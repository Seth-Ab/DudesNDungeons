import { expect, test } from "@playwright/test";
import { enterHub } from "./designScreen.js";
import { walkTo } from "./walk.js";

const TORCH = { x: 25.5, y: 22.75 };
const GATE = { x: 45.5, y: 5.5 };
const TO_TORCHES = [
  { x: 33.5, y: 29.5 },
  { x: 33.5, y: 25.5 },
];
const TO_GATE = [
  { x: 33.5, y: 25.5 },
  { x: 33.5, y: 17.5 },
  { x: 45.5, y: 17.5 },
];

test.describe("Torch tally", () => {
  test("sits under the minimap in a run with no digits, and shows each stage", async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto("/?debug");
    await page.getByPlaceholder("Your name").fill("Maya");
    await page.getByRole("button", { name: "Create a new dungeon" }).click();
    await enterHub(page);
    await expect(page.locator(".hud__tally")).toBeHidden();

    for (const waypoint of TO_TORCHES) await walkTo(page, waypoint, 0.6);
    await walkTo(page, { x: TORCH.x, y: TORCH.y + 1.75 }, 0.3);
    await page.keyboard.down("w");
    await page.waitForTimeout(400);
    await page.keyboard.up("w");
    await page.keyboard.press("f");
    await page.getByRole("button", { name: "Ready" }).click();
    for (const waypoint of TO_GATE) await walkTo(page, waypoint, 0.6);
    await walkTo(page, GATE, 1);

    const tally = page.locator(".hud__tally");
    await expect(async () => {
      await page.keyboard.press("e");
      await expect(tally).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 15_000 });

    const minimap = await page.locator(".hud__minimap").boundingBox();
    const box = await tally.boundingBox();
    if (!minimap || !box) throw new Error("missing boxes");
    expect(box.y).toBeGreaterThanOrEqual(minimap.y + minimap.height);
    expect(Math.abs(box.x - minimap.x)).toBeLessThan(1);

    await expect(tally).toHaveAttribute("aria-label", /^Run time \d+:\d\d\. Decay in \d+:\d\d\.$/);
    expect(await tally.innerText()).not.toMatch(/\d/);
    await expect(tally).toHaveAttribute("data-stage", "neutral");
    await page.screenshot({ path: testInfo.outputPath("tally-neutral.png") });

    // The 10-minute decay window is not waited out: the same element is built with each later stage.
    await page.evaluate(async () => {
      const { createRunClock } = await import("/src/client/ui/hud/runClock.ts");
      const corner = document.querySelector(".hud__corner");
      document.querySelector(".hud__tally")?.setAttribute("hidden", "");
      const stages = [
        { label: "Run time 8:40. Decay in 1:20.", status: "", mark: "", ratio: 0.13, stage: "neutral" },
        { label: "Run time 9:30. Decay in 0:30.", status: "Decay near", mark: "!", ratio: 0.05, stage: "warning" },
        { label: "Run time 11:40. Resistance falling.", status: "Resistance falling", mark: "▼", ratio: 0, stage: "decaying" },
      ] as const;
      for (const view of stages) {
        const extra = createRunClock();
        extra.element.classList.add("hud__tally--sample");
        extra.update(view);
        corner?.append(extra.element);
      }
    });
    const samples = page.locator(".hud__tally--sample");
    await expect(samples.nth(2)).toContainText("▼ Resistance falling");
    await expect(samples.nth(2)).toHaveAttribute("aria-label", "Run time 11:40. Resistance falling.");
    await expect(samples.nth(1)).toHaveCSS("--tally-color", /.+/);
    await page.screenshot({ path: testInfo.outputPath("tally-stages.png") });
  });
});
