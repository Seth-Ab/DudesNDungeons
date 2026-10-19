import type { Vector2 } from "../../shared/types/core.js";
import type { PlacedEmote } from "../state/emotes.js";

/** Bubble tip, in world units above the emoter's centre: clear of the figure's head. */
const BUBBLE_LIFT = 1.1;
const PADDING_X = 7;
const HEIGHT = 22;
const TAIL = 6;
const FADE_FROM = 0.75;

const colors = {
  fill: "#f7f0da",
  border: "#2b2630",
  text: "#191b1f",
};

/**
 * Speech bubbles over emoting players, drawn last so nothing in the world covers them. Fades out
 * over the last quarter of its life. `toScreen` maps a world position to the canvas, so this module
 * knows nothing about the camera.
 */
export function drawEmoteBubbles(
  ctx: CanvasRenderingContext2D,
  emotes: readonly PlacedEmote[],
  toScreen: (position: Vector2) => Vector2,
): void {
  if (emotes.length === 0) return;

  ctx.save();
  ctx.font = "bold 13px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";

  for (const emote of emotes) {
    const tip = toScreen({ x: emote.position.x, y: emote.position.y - BUBBLE_LIFT });
    const width = Math.ceil(ctx.measureText(emote.text).width) + PADDING_X * 2;
    const left = Math.round(tip.x - width / 2);
    const top = Math.round(tip.y - TAIL - HEIGHT);

    ctx.globalAlpha =
      emote.progress < FADE_FROM ? 1 : Math.max(0, 1 - (emote.progress - FADE_FROM) / (1 - FADE_FROM));

    ctx.beginPath();
    ctx.roundRect(left, top, width, HEIGHT, 6);
    ctx.moveTo(tip.x - TAIL, top + HEIGHT);
    ctx.lineTo(tip.x, tip.y);
    ctx.lineTo(tip.x + TAIL, top + HEIGHT);
    ctx.fillStyle = colors.fill;
    ctx.strokeStyle = colors.border;
    ctx.stroke();
    ctx.fill();

    ctx.fillStyle = colors.text;
    ctx.fillText(emote.text, tip.x, top + HEIGHT / 2 + 1);
  }

  ctx.restore();
}
