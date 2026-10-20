import type { Page } from "@playwright/test";

/** How far short of the target a held key is let go, to leave room for the stop to land. */
const COAST = 1;
/** A leg longer than this is walked with one held key; the rest is steered in short taps. */
const LONG_LEG = 2;

export async function position(page: Page): Promise<{ x: number; y: number }> {
  const text = (await page.getByText("Position:").textContent()) ?? "";
  const [x, y] = (text.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  if (x === undefined || y === undefined) throw new Error(`No position in "${text}"`);
  return { x, y };
}

/**
 * Walks until the predicted position is within `reach` of `target`, steering by the debug readout
 * rather than by time, so a loaded machine that moves fewer steps per second still arrives.
 *
 * A long leg holds its key while the page watches the readout every frame, and lets go `COAST`
 * short of the target; only the last stretch is steered in short taps. Checking from the page
 * rather than over the wire after every 200ms slice is what makes the long walks fast.
 */
export async function walkTo(
  page: Page,
  target: { x: number; y: number },
  reach: number,
): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const at = await position(page);
    const dx = target.x - at.x;
    const dy = target.y - at.y;
    if (Math.hypot(dx, dy) <= reach) return;

    const alongX = Math.abs(dx) >= Math.abs(dy);
    const key = alongX ? (dx > 0 ? "d" : "a") : dy > 0 ? "s" : "w";
    const remaining = alongX ? Math.abs(dx) : Math.abs(dy);

    await page.keyboard.down(key);
    if (remaining > LONG_LEG) {
      // Held until the leg is nearly done, or for a bounded time if something blocks the way.
      const axis = alongX ? "x" : "y";
      const goal = alongX ? target.x : target.y;
      const forward = key === "d" || key === "s";
      const reached = forward ? `value >= ${goal - COAST}` : `value <= ${goal + COAST}`;
      await page
        .waitForFunction(
          `(() => {
            const readout = Array.from(document.querySelectorAll("*")).find(
              (node) => node.textContent.trim().startsWith("Position:") && node.children.length <= 1,
            );
            const [x, y] = (readout?.textContent.match(/-?\\d+(\\.\\d+)?/g) ?? []).map(Number);
            const value = ${axis};
            return value !== undefined && ${reached};
          })()`,
          undefined,
          { polling: "raf", timeout: 8_000 },
        )
        .catch(() => undefined);
    } else {
      await page.waitForTimeout(40);
    }
    await page.keyboard.up(key);
  }
  throw new Error(`Never reached ${JSON.stringify(target)}`);
}
