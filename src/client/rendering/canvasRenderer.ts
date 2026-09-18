import { PLAYER_TORCH_LIGHT_RADIUS, TILE_SCALE } from "../../shared/constants/game.js";
import { PLAYER_RADIUS } from "../../shared/game/movement.js";
import type {
  DoorState,
  DungeonState,
  MonsterState,
  PlayerState,
  Vector2,
} from "../../shared/types/core.js";

/**
 * Screen pixels per world unit.
 *
 * Down from the 48 a tile used to get, because a tile is no longer a world unit: at `TILE_SCALE` an
 * authored tile is a 4x4 block, so an authored tile still draws at 128px while the player, who did
 * not grow, is a fifth of the width of the corridor they stand in. That is the point of the change -
 * the dungeon is bigger around you, not merely drawn closer.
 */
const pixelsPerWorldUnit = 32;

/** Player figure, in world units. Its width is the body the server collides with. */
const figureWidth = PLAYER_RADIUS * 2;
const figureHeight = PLAYER_RADIUS * 2.6;

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
  openDoor: "#3d3a2d",
  exit: "#6aa36f",
  light: "#f0c66a",
  label: "#f7f0da",
};

const tileColors: Record<string, string> = {
  "#": colors.wall,
  "+": colors.discoveredWall,
  ",": colors.discoveredFloor,
  " ": colors.unknown,
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
    x: viewportWidth / 2 + (position.x - camera.x) * pixelsPerWorldUnit,
    y: viewportHeight / 2 + (position.y - camera.y) * pixelsPerWorldUnit,
  });

  /** A square of `size` world units centred on a world position. */
  const drawWorldRect = (center: Vector2, size: number, color: string, camera: Vector2): void => {
    const topLeft = worldToScreen({ x: center.x - size / 2, y: center.y - size / 2 }, camera);
    const side = size * pixelsPerWorldUnit;
    ctx.fillStyle = color;
    ctx.fillRect(topLeft.x, topLeft.y, side, side);
  };

  /**
   * The world tiles the viewport covers.
   *
   * Drawing the whole map is no longer an option: a scaled world is 384x256 tiles, and a snapshot
   * only carries a window of it anyway. This clips to what is on screen, intersected with the window
   * that arrived, so the cost of a frame follows the viewport rather than the size of the dungeon.
   */
  const visibleTileRange = (dungeon: DungeonState, camera: Vector2) => {
    const { map } = dungeon;
    const halfX = viewportWidth / 2 / pixelsPerWorldUnit;
    const halfY = viewportHeight / 2 / pixelsPerWorldUnit;
    const windowWidth = map.tiles[0]?.length ?? 0;

    return {
      minX: Math.max(map.originX, Math.floor(camera.x - halfX)),
      maxX: Math.min(map.originX + windowWidth - 1, Math.ceil(camera.x + halfX)),
      minY: Math.max(map.originY, Math.floor(camera.y - halfY)),
      maxY: Math.min(map.originY + map.tiles.length - 1, Math.ceil(camera.y + halfY)),
    };
  };

  /**
   * Fills the tiles on screen, and rules the floor into the blocks it was authored in.
   *
   * The masonry lines fall every `TILE_SCALE` units, which is one authored tile: ruling every world
   * tile would draw a grid four times finer than anything the level was built from, and read as
   * graph paper rather than as a floor. They are drawn tile by tile alongside the fill rather than
   * swept across the viewport, so they stop where the player's knowledge of the map stops. Ruling
   * the void would put a grid over space nobody has seen.
   */
  const drawTiles = (dungeon: DungeonState, camera: Vector2): void => {
    const { map } = dungeon;
    const { minX, maxX, minY, maxY } = visibleTileRange(dungeon, camera);

    const lines = new Path2D();
    let ruled = false;

    for (let y = minY; y <= maxY; y += 1) {
      const row = map.tiles[y - map.originY];
      if (row === undefined) continue;

      for (let x = minX; x <= maxX; x += 1) {
        const tile = row[x - map.originX] ?? " ";
        if (tile === " ") continue;

        const topLeft = worldToScreen({ x: x - 0.5, y: y - 0.5 }, camera);
        ctx.fillStyle = tileColors[tile] ?? colors.floor;
        // Rounded out by a pixel so neighbouring tiles never leave a seam between them.
        ctx.fillRect(topLeft.x, topLeft.y, pixelsPerWorldUnit + 1, pixelsPerWorldUnit + 1);

        if (x % TILE_SCALE === 0) {
          lines.moveTo(topLeft.x, topLeft.y);
          lines.lineTo(topLeft.x, topLeft.y + pixelsPerWorldUnit);
          ruled = true;
        }
        if (y % TILE_SCALE === 0) {
          lines.moveTo(topLeft.x, topLeft.y);
          lines.lineTo(topLeft.x + pixelsPerWorldUnit, topLeft.y);
          ruled = true;
        }
      }
    }

    if (!ruled) return;

    ctx.strokeStyle = colors.grid;
    ctx.globalAlpha = 0.25;
    ctx.stroke(lines);
    ctx.globalAlpha = 1;
  };

  const drawFigure = (
    position: Vector2,
    label: string,
    color: string,
    faded: boolean,
    camera: Vector2,
  ): void => {
    const center = worldToScreen(position, camera);
    const width = figureWidth * pixelsPerWorldUnit;
    const height = figureHeight * pixelsPerWorldUnit;
    const eye = Math.max(2, width * 0.17);

    ctx.globalAlpha = faded ? 0.45 : 1;
    ctx.fillStyle = color;
    ctx.fillRect(center.x - width / 2, center.y - height / 2, width, height);
    ctx.fillStyle = "#17120c";
    ctx.fillRect(center.x - width * 0.22 - eye / 2, center.y - height * 0.25, eye, eye);
    ctx.fillRect(center.x + width * 0.22 - eye / 2, center.y - height * 0.25, eye, eye);
    // Names stay a fixed size: a label is read, not inhabited, so it is not part of the world.
    ctx.fillStyle = colors.label;
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(label, center.x, center.y + height / 2 + 14);
    ctx.globalAlpha = 1;
  };

  const drawMonster = (monster: MonsterState, camera: Vector2): void => {
    const center = worldToScreen(monster.position, camera);
    const side = figureWidth * 1.15 * pixelsPerWorldUnit;
    const eye = Math.max(2, side * 0.18);

    ctx.fillStyle = colors.monster;
    ctx.fillRect(center.x - side / 2, center.y - side / 2, side, side);
    ctx.fillStyle = "#2b0f0f";
    ctx.fillRect(center.x - side * 0.22 - eye / 2, center.y - side * 0.12, eye, eye);
    ctx.fillRect(center.x + side * 0.22 - eye / 2, center.y - side * 0.12, eye, eye);

    const barWidth = side * 1.15;
    const healthWidth = Math.max(0, (monster.health / monster.maxHealth) * barWidth);
    const barY = center.y - side / 2 - 10;
    ctx.fillStyle = "#161616";
    ctx.fillRect(center.x - barWidth / 2, barY, barWidth, 4);
    ctx.fillStyle = "#caa85a";
    ctx.fillRect(center.x - barWidth / 2, barY, healthWidth, 4);
  };

  /** A door is drawn across its whole opening, which is the span the server collides against. */
  const drawDoor = (door: DoorState, camera: Vector2): void => {
    drawWorldRect(door.position, door.size, door.open ? colors.openDoor : colors.door, camera);
  };

  const drawLightMask = (camera: Vector2): void => {
    const center = worldToScreen(camera, camera);
    const radius = PLAYER_TORCH_LIGHT_RADIUS * pixelsPerWorldUnit;
    const gradient = ctx.createRadialGradient(
      center.x,
      center.y,
      radius * 0.3,
      center.x,
      center.y,
      radius,
    );
    gradient.addColorStop(0, "rgba(6, 7, 10, 0)");
    gradient.addColorStop(0.68, "rgba(6, 7, 10, 0.18)");
    gradient.addColorStop(1, "rgba(6, 7, 10, 0.78)");

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, viewportWidth, viewportHeight);
  };

  function render(): void {
    const scene = getScene();
    const camera = scene.self
      ? scene.localPosition
      : { x: scene.dungeon.map.width / 2, y: scene.dungeon.map.height / 2 };

    // Undiscovered space, and anything outside the window this snapshot carried, is simply black.
    ctx.fillStyle = colors.unknown;
    ctx.fillRect(0, 0, viewportWidth, viewportHeight);

    drawTiles(scene.dungeon, camera);

    scene.dungeon.doors.forEach((door) => drawDoor(door, camera));
    scene.dungeon.lightSources.forEach((light) =>
      drawWorldRect(light.position, light.kind === "fixed" ? 0.75 : 0.5, colors.light, camera),
    );
    scene.dungeon.exits.forEach((exit) => drawWorldRect(exit.position, 1.6, colors.exit, camera));
    scene.dungeon.loot
      .filter((loot) => !loot.pickedUp)
      .forEach((loot) => drawWorldRect(loot.position, 0.55, colors.loot, camera));
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
