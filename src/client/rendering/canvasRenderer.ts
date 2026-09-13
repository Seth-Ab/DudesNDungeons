import type { PlayerState, Vector2 } from "../../shared/types/core.js";
import type { DungeonMap } from "../state/gameState.js";

const tileSize = 48;

const colors = {
  floor: "#2d3033",
  wall: "#0e0f12",
  grid: "#3a3329",
  localPlayer: "#d9b85f",
  remotePlayer: "#7eb3c7",
  disconnectedPlayer: "#5a5f63",
  monster: "#b8584c",
  label: "#f7f0da",
};

export interface Scene {
  dungeon: DungeonMap;
  /** Locally predicted position for the player at this client, drawn ahead of the server. */
  localPosition: Vector2;
  self: PlayerState | null;
  others: PlayerState[];
}

export function createCanvasRenderer(getScene: () => Scene) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Canvas 2D context is unavailable.");
  }

  const ctx = context;
  canvas.className = "game-canvas";

  const resize = (): void => {
    const pixelRatio = window.devicePixelRatio || 1;
    const width = window.innerWidth;
    const height = Math.max(window.innerHeight - 58, 320);

    canvas.width = Math.floor(width * pixelRatio);
    canvas.height = Math.floor(height * pixelRatio);
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    render();
  };

  const drawTile = (x: number, y: number, value: string): void => {
    ctx.fillStyle = value === "#" ? colors.wall : colors.floor;
    ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
    ctx.strokeStyle = colors.grid;
    ctx.strokeRect(x * tileSize, y * tileSize, tileSize, tileSize);
  };

  const drawFigure = (position: Vector2, label: string, color: string, faded: boolean): void => {
    const centerX = position.x * tileSize + tileSize / 2;
    const centerY = position.y * tileSize + tileSize / 2;

    ctx.globalAlpha = faded ? 0.45 : 1;
    ctx.fillStyle = color;
    ctx.fillRect(centerX - 12, centerY - 14, 24, 28);
    ctx.fillStyle = "#17120c";
    ctx.fillRect(centerX - 5, centerY - 7, 4, 4);
    ctx.fillRect(centerX + 4, centerY - 7, 4, 4);
    ctx.fillStyle = colors.label;
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(label, centerX, centerY + 28);
    ctx.globalAlpha = 1;
  };

  const drawMonster = (position: Vector2): void => {
    const centerX = position.x * tileSize + tileSize / 2;
    const centerY = position.y * tileSize + tileSize / 2;

    ctx.fillStyle = colors.monster;
    ctx.fillRect(centerX - 13, centerY - 13, 26, 26);
    ctx.fillStyle = "#2b0f0f";
    ctx.fillRect(centerX - 7, centerY - 5, 5, 5);
    ctx.fillRect(centerX + 3, centerY - 5, 5, 5);
  };

  function render(): void {
    const scene = getScene();
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    scene.dungeon.tiles.forEach((row, y) => {
      row.split("").forEach((tile, x) => drawTile(x, y, tile));
    });
    scene.dungeon.monsters.forEach(drawMonster);

    for (const player of scene.others) {
      drawFigure(player.position, player.name, colors.remotePlayer, !player.connected);
    }

    if (scene.self) {
      drawFigure(scene.localPosition, scene.self.name, colors.localPlayer, false);
    }
  }

  window.addEventListener("resize", resize);
  resize();

  return { canvas, render };
}
