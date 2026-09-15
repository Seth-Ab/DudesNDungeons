import type { DungeonState, MonsterState, PlayerState, Vector2 } from "../../shared/types/core.js";

const tileSize = 48;
const playerLightRadius = 4.2;

const colors = {
  floor: "#2d3033",
  discoveredFloor: "#17191c",
  wall: "#0e0f12",
  discoveredWall: "#090a0d",
  unknown: "#050609",
  grid: "#3a3329",
  localPlayer: "#d9b85f",
  remotePlayer: "#7eb3c7",
  disconnectedPlayer: "#5a5f63",
  downedPlayer: "#6c4d5f",
  monster: "#b8584c",
  loot: "#d6a84c",
  door: "#8f6335",
  exit: "#6aa36f",
  light: "#f0c66a",
  label: "#f7f0da",
  shadow: "#06070a",
};

export interface Scene {
  dungeon: DungeonState;
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
  let viewportWidth = window.innerWidth;
  let viewportHeight = Math.max(window.innerHeight - 58, 320);

  const resize = (): void => {
    const pixelRatio = window.devicePixelRatio || 1;
    const bounds = canvas.getBoundingClientRect();
    const width = bounds.width > 0 ? bounds.width : window.innerWidth;
    const height = Math.max(bounds.height > 0 ? bounds.height : window.innerHeight - 58, 320);
    viewportWidth = width;
    viewportHeight = height;

    canvas.width = Math.floor(width * pixelRatio);
    canvas.height = Math.floor(height * pixelRatio);
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    render();
  };

  const worldToScreen = (position: Vector2, camera: Vector2): Vector2 => ({
    x: viewportWidth / 2 + (position.x - camera.x) * tileSize,
    y: viewportHeight / 2 + (position.y - camera.y) * tileSize,
  });

  const drawTile = (x: number, y: number, value: string, camera: Vector2): void => {
    const topLeft = worldToScreen({ x: x - 0.5, y: y - 0.5 }, camera);
    ctx.fillStyle =
      value === "#"
        ? colors.wall
        : value === "+"
          ? colors.discoveredWall
          : value === ","
            ? colors.discoveredFloor
            : value === " "
              ? colors.unknown
              : colors.floor;
    ctx.fillRect(topLeft.x, topLeft.y, tileSize, tileSize);
    if (value !== " ") {
      ctx.strokeStyle = colors.grid;
      ctx.strokeRect(topLeft.x, topLeft.y, tileSize, tileSize);
    }
  };

  const drawFigure = (
    position: Vector2,
    label: string,
    color: string,
    faded: boolean,
    camera: Vector2,
  ): void => {
    const center = worldToScreen(position, camera);

    ctx.globalAlpha = faded ? 0.45 : 1;
    ctx.fillStyle = color;
    ctx.fillRect(center.x - 12, center.y - 14, 24, 28);
    ctx.fillStyle = "#17120c";
    ctx.fillRect(center.x - 5, center.y - 7, 4, 4);
    ctx.fillRect(center.x + 4, center.y - 7, 4, 4);
    ctx.fillStyle = colors.label;
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(label, center.x, center.y + 28);
    ctx.globalAlpha = 1;
  };

  const drawMonster = (monster: MonsterState, camera: Vector2): void => {
    const center = worldToScreen(monster.position, camera);

    ctx.fillStyle = colors.monster;
    ctx.fillRect(center.x - 13, center.y - 13, 26, 26);
    ctx.fillStyle = "#2b0f0f";
    ctx.fillRect(center.x - 7, center.y - 5, 5, 5);
    ctx.fillRect(center.x + 3, center.y - 5, 5, 5);

    const width = 30;
    const healthWidth = Math.max(0, (monster.health / monster.maxHealth) * width);
    ctx.fillStyle = "#161616";
    ctx.fillRect(center.x - width / 2, center.y - 24, width, 4);
    ctx.fillStyle = "#caa85a";
    ctx.fillRect(center.x - width / 2, center.y - 24, healthWidth, 4);
  };

  const drawMarker = (position: Vector2, color: string, size: number, camera: Vector2): void => {
    const center = worldToScreen(position, camera);
    ctx.fillStyle = color;
    ctx.fillRect(center.x - size / 2, center.y - size / 2, size, size);
  };

  const drawLightMask = (camera: Vector2): void => {
    const center = worldToScreen(camera, camera);
    const radius = playerLightRadius * tileSize;
    const gradient = ctx.createRadialGradient(center.x, center.y, radius * 0.3, center.x, center.y, radius);
    gradient.addColorStop(0, "rgba(6, 7, 10, 0)");
    gradient.addColorStop(0.68, "rgba(6, 7, 10, 0.18)");
    gradient.addColorStop(1, "rgba(6, 7, 10, 0.78)");

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, viewportWidth, viewportHeight);
  };

  function render(): void {
    const scene = getScene();
    const camera = scene.self ? scene.localPosition : { x: scene.dungeon.map.width / 2, y: scene.dungeon.map.height / 2 };
    ctx.clearRect(0, 0, viewportWidth, viewportHeight);

    scene.dungeon.map.tiles.forEach((row, y) => {
      row.split("").forEach((tile, x) => drawTile(x, y, tile, camera));
    });

    scene.dungeon.doors.forEach((door) =>
      drawMarker(door.position, door.open ? "#3d3a2d" : colors.door, 34, camera),
    );
    scene.dungeon.lightSources.forEach((light) => {
      const size = light.kind === "fixed" ? 14 : 10;
      drawMarker(light.position, colors.light, size, camera);
    });
    scene.dungeon.exits.forEach((exit) => drawMarker(exit.position, colors.exit, 28, camera));
    scene.dungeon.loot
      .filter((loot) => !loot.pickedUp)
      .forEach((loot) => drawMarker(loot.position, colors.loot, 18, camera));
    scene.dungeon.monsters
      .filter((monster) => monster.alive)
      .forEach((monster) => drawMonster(monster, camera));

    for (const player of scene.others) {
      const color = player.health > 0 ? colors.remotePlayer : colors.downedPlayer;
      drawFigure(player.position, player.name, color, !player.connected, camera);
    }

    if (scene.self) {
      const color = scene.self.health > 0 ? colors.localPlayer : colors.downedPlayer;
      drawFigure(scene.localPosition, scene.self.name, color, false, camera);
    }

    drawLightMask(camera);
  }

  window.addEventListener("resize", resize);
  resize();

  return { canvas, render, resize };
}
