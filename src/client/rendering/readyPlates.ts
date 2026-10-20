import { READY_PLATE_SIZE } from "../../shared/constants/game.js";
import type { MapReadyPlate, PlayerState, Vector2 } from "../../shared/types/core.js";
import { PARTY_PALETTES } from "./characterPalettes.js";

const colors = {
  stone: "#3b3a3f",
  stoneEdge: "#5d5b63",
  rune: "#24232a",
};

/**
 * The ready plates in front of the hub gate: a worn stone slab while free, lit in its holder's
 * party colour while held. `toScreen` maps a world position to the canvas and `unit` is screen
 * pixels per world unit, so this module knows nothing about the camera.
 */
export function drawReadyPlates(
  ctx: CanvasRenderingContext2D,
  plates: readonly MapReadyPlate[],
  players: readonly PlayerState[],
  toScreen: (position: Vector2) => Vector2,
  unit: number,
): void {
  const side = READY_PLATE_SIZE * unit;
  const inset = Math.max(2, Math.round(unit / 8));

  for (const plate of plates) {
    const holder = players.find((player) => player.readyPlateId === plate.id);
    const lit = holder ? PARTY_PALETTES[holder.partyColor].ring : null;
    const centre = toScreen(plate);
    const left = Math.round(centre.x - side / 2);
    const top = Math.round(centre.y - side / 2);

    ctx.save();
    ctx.fillStyle = lit ?? colors.stoneEdge;
    ctx.fillRect(left, top, side, side);
    ctx.fillStyle = colors.stone;
    ctx.fillRect(left + inset, top + inset, side - inset * 2, side - inset * 2);
    if (lit) {
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = lit;
      ctx.fillRect(left + inset, top + inset, side - inset * 2, side - inset * 2);
      ctx.globalAlpha = 1;
    }
    // A diamond rune in the middle, bright on a lit plate and cut into the stone on a free one.
    const rune = side / 6;
    ctx.fillStyle = lit ?? colors.rune;
    ctx.beginPath();
    ctx.moveTo(centre.x, centre.y - rune);
    ctx.lineTo(centre.x + rune, centre.y);
    ctx.lineTo(centre.x, centre.y + rune);
    ctx.lineTo(centre.x - rune, centre.y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
