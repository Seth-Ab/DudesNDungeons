import { TRAINING_DUMMY_WINDOW_MS } from "../../shared/constants/game.js";
import type { DummyState, Vector2 } from "../../shared/types/core.js";
import { dummyPlate } from "../state/trainingDummies.js";

const colors = {
  post: "#5b3f26",
  postShade: "#3f2b19",
  straw: "#c9a45c",
  strawShade: "#9c7b3c",
  sack: "#d8c49a",
  twine: "#6e4a2a",
  target: "#b23a2e",
  shadow: "rgba(0, 0, 0, 0.28)",
  plate: "rgba(18, 16, 22, 0.82)",
  plateEdge: "#c9a45c",
  plateText: "#f7e7bf",
  plateDetail: "#c8b894",
};

/**
 * Plate bottom, in world units above the dummy's position: clear of its head and above where the
 * damage numbers (which start just over a struck target and drift up) are still easy to read.
 */
const PLATE_LIFT = 2.4;

/**
 * Training dummies: a straw figure on a post, drawn with the rest of the world so light falls on
 * it. `wobbles` leans a struck dummy about its foot. `toScreen` maps a world position to the canvas
 * and `unit` is screen pixels per world unit, so this module knows nothing about the camera.
 */
export function drawTrainingDummies(
  ctx: CanvasRenderingContext2D,
  dummies: readonly DummyState[],
  wobbles: ReadonlyMap<string, number>,
  toScreen: (position: Vector2) => Vector2,
  unit: number,
): void {
  for (const dummy of dummies) {
    const center = toScreen(dummy.position);
    const foot = { x: center.x, y: center.y + 0.45 * unit };

    ctx.save();
    ctx.fillStyle = colors.shadow;
    ctx.beginPath();
    ctx.ellipse(foot.x, foot.y, 0.4 * unit, 0.14 * unit, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.translate(foot.x, foot.y);
    ctx.rotate(wobbles.get(dummy.id) ?? 0);
    // Everything below is relative to the foot, with up as negative y.
    const u = unit;
    ctx.fillStyle = colors.postShade;
    ctx.fillRect(-0.08 * u, -0.5 * u, 0.16 * u, 0.5 * u);
    ctx.fillStyle = colors.post;
    ctx.fillRect(-0.06 * u, -0.5 * u, 0.1 * u, 0.5 * u);
    // Arms: a crossbar through the shoulders.
    ctx.fillRect(-0.5 * u, -0.98 * u, 1 * u, 0.1 * u);

    ctx.fillStyle = colors.strawShade;
    ctx.fillRect(-0.3 * u, -1.08 * u, 0.6 * u, 0.62 * u);
    ctx.fillStyle = colors.straw;
    ctx.fillRect(-0.26 * u, -1.06 * u, 0.48 * u, 0.56 * u);
    ctx.fillStyle = colors.twine;
    ctx.fillRect(-0.3 * u, -0.66 * u, 0.6 * u, 0.05 * u);

    ctx.strokeStyle = colors.target;
    ctx.lineWidth = Math.max(1.5, 0.05 * u);
    ctx.beginPath();
    ctx.arc(0, -0.82 * u, 0.13 * u, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = colors.target;
    ctx.fillRect(-0.04 * u, -0.86 * u, 0.08 * u, 0.08 * u);

    ctx.fillStyle = colors.sack;
    ctx.beginPath();
    ctx.arc(0, -1.26 * u, 0.2 * u, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = colors.twine;
    ctx.fillRect(-0.12 * u, -1.1 * u, 0.24 * u, 0.04 * u);
    ctx.restore();
  }
}

/**
 * The damage-per-second plate over each dummy someone has hit in the last few seconds, drawn over
 * the lighting with the other overlays so it stays readable. The figures are the server's.
 */
export function drawDummyPlates(
  ctx: CanvasRenderingContext2D,
  dummies: readonly DummyState[],
  toScreen: (position: Vector2) => Vector2,
): void {
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (const dummy of dummies) {
    const plate = dummyPlate(dummy, TRAINING_DUMMY_WINDOW_MS);
    if (!plate) continue;

    const at = toScreen({ x: dummy.position.x, y: dummy.position.y - PLATE_LIFT });
    ctx.font = "bold 13px sans-serif";
    const headWidth = ctx.measureText(plate.dps).width;
    ctx.font = "11px sans-serif";
    const width = Math.ceil(Math.max(headWidth, ctx.measureText(plate.detail).width)) + 14;
    const height = 34;
    const left = Math.round(at.x - width / 2);
    const top = Math.round(at.y - height);

    ctx.fillStyle = colors.plate;
    ctx.strokeStyle = colors.plateEdge;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(left, top, width, height, 4);
    ctx.fill();
    ctx.stroke();

    ctx.font = "bold 13px sans-serif";
    ctx.fillStyle = colors.plateText;
    ctx.fillText(plate.dps, at.x, top + 11);
    ctx.font = "11px sans-serif";
    ctx.fillStyle = colors.plateDetail;
    ctx.fillText(plate.detail, at.x, top + 25);
  }

  ctx.restore();
}
