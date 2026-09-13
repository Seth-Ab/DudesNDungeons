import type { GameState, PlayerState } from "../state/gameState";

const tileSize = 48;

const colors = {
  floor: "#2d3033",
  wall: "#0e0f12",
  grid: "#3a3329",
  localPlayer: "#d9b85f",
  remotePlayer: "#7eb3c7",
  monster: "#b8584c",
};

export function createCanvasRenderer(gameState: GameState) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Canvas 2D context is unavailable.");
  }

  const ctx = context;
  canvas.className = "game-canvas";

  const resize = () => {
    const pixelRatio = window.devicePixelRatio || 1;
    const width = window.innerWidth;
    const height = Math.max(window.innerHeight - 58, 320);

    canvas.width = Math.floor(width * pixelRatio);
    canvas.height = Math.floor(height * pixelRatio);
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    render();
  };

  const drawTile = (x: number, y: number, value: string) => {
    ctx.fillStyle = value === "#" ? colors.wall : colors.floor;
    ctx.fillRect(x * tileSize, y * tileSize, tileSize, tileSize);
    ctx.strokeStyle = colors.grid;
    ctx.strokeRect(x * tileSize, y * tileSize, tileSize, tileSize);
  };

  const drawPlayer = (player: PlayerState, color: string) => {
    const centerX = player.position.x * tileSize + tileSize / 2;
    const centerY = player.position.y * tileSize + tileSize / 2;

    ctx.fillStyle = color;
    ctx.fillRect(centerX - 12, centerY - 14, 24, 28);
    ctx.fillStyle = "#17120c";
    ctx.fillRect(centerX - 5, centerY - 7, 4, 4);
    ctx.fillRect(centerX + 4, centerY - 7, 4, 4);
    ctx.fillStyle = "#f7f0da";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(player.name, centerX, centerY + 28);
  };

  const drawMonster = (x: number, y: number) => {
    const centerX = x * tileSize + tileSize / 2;
    const centerY = y * tileSize + tileSize / 2;

    ctx.fillStyle = colors.monster;
    ctx.fillRect(centerX - 13, centerY - 13, 26, 26);
    ctx.fillStyle = "#2b0f0f";
    ctx.fillRect(centerX - 7, centerY - 5, 5, 5);
    ctx.fillRect(centerX + 3, centerY - 5, 5, 5);
  };

  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    gameState.dungeon.tiles.forEach((row, y) => {
      row.split("").forEach((tile, x) => drawTile(x, y, tile));
    });
    gameState.dungeon.monsters.forEach((monster) => drawMonster(monster.x, monster.y));
    gameState.remotePlayers.forEach((player) => drawPlayer(player, colors.remotePlayer));
    drawPlayer(gameState.localPlayer, colors.localPlayer);
  }

  window.addEventListener("resize", resize);
  resize();

  return {
    canvas,
    render,
  };
}
