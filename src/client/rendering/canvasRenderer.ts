import {
  PLAYER_ATTACK_ARC_COS,
  PLAYER_ATTACK_RANGE,
  PLAYER_MAX_HEALTH,
} from "../../shared/constants/game.js";
import type {
  DoorState,
  DungeonState,
  ExitState,
  LootState,
  MonsterState,
  PlayerState,
  Vector2,
} from "../../shared/types/core.js";
import { FLOATER_MS, SWING_MS, type Effects } from "../state/effects.js";
import type { Interaction } from "../state/gameState.js";

const TILE = 48;
/** Must match the HUD height the canvas is sized around in `styles.css`. */
const HUD_HEIGHT = 58;
/** Upscaling past this makes the placeholder shapes look blurry rather than chunky. */
const MAX_SCALE = 1.5;

const colors = {
  floor: "#2d3033",
  floorAlt: "#2a2d30",
  wall: "#0e0f12",
  wallTop: "#1f2025",
  grid: "#3a3329",
  localPlayer: "#d9b85f",
  remotePlayer: "#7eb3c7",
  downedPlayer: "#6b6f73",
  eyes: "#17120c",
  monster: "#b8584c",
  monsterEyes: "#2b0f0f",
  label: "#f7f0da",
  healthBack: "#2b0f0f",
  health: "#6fbf6a",
  healthLow: "#d9784c",
  door: "#6b4a2b",
  doorPlank: "#3f2b18",
  lock: "#e0c060",
  key: "#e0c060",
  tonic: "#c9474f",
  glass: "#f0d6d8",
  exit: "#2f4a73",
  exitStep: "#8fb8f0",
  swing: "#f7f0da",
  damage: "#f7f0da",
  hurt: "#ef6b6b",
  promptBack: "rgba(16, 17, 20, 0.88)",
  prompt: "#f7f0da",
  promptMuted: "#b9ad8f",
};

export interface Scene {
  tiles: readonly string[];
  /** Null before the first snapshot, when only the placeholder tiles are drawn. */
  dungeon: DungeonState | null;
  /** Locally predicted position for the player at this client, drawn ahead of the server. */
  localPosition: Vector2;
  self: PlayerState | null;
  others: PlayerState[];
  effects: Effects;
  interaction: Interaction | null;
  /** `performance.now()` for this frame, which drives every animation. */
  now: number;
}

export function createCanvasRenderer(getScene: () => Scene) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Canvas 2D context is unavailable.");
  }

  const ctx = context;
  canvas.className = "game-canvas";

  let cssWidth = 0;
  let cssHeight = 0;
  let pixelRatio = 1;

  const resize = (): void => {
    pixelRatio = window.devicePixelRatio || 1;
    cssWidth = window.innerWidth;
    cssHeight = Math.max(window.innerHeight - HUD_HEIGHT, 320);
    canvas.width = Math.floor(cssWidth * pixelRatio);
    canvas.height = Math.floor(cssHeight * pixelRatio);
    render();
  };

  /** Integer world positions are tile centers, matching the server's collision. */
  const toPixels = (position: Vector2): Vector2 => ({
    x: position.x * TILE + TILE / 2,
    y: position.y * TILE + TILE / 2,
  });

  const drawTile = (x: number, y: number, value: string): void => {
    const px = x * TILE;
    const py = y * TILE;

    if (value === "#") {
      ctx.fillStyle = colors.wall;
      ctx.fillRect(px, py, TILE, TILE);
      ctx.fillStyle = colors.wallTop;
      ctx.fillRect(px, py, TILE, 6);
      return;
    }

    ctx.fillStyle = (x + y) % 2 === 0 ? colors.floor : colors.floorAlt;
    ctx.fillRect(px, py, TILE, TILE);
    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 0.5, py + 0.5, TILE - 1, TILE - 1);
  };

  const drawExit = (exit: ExitState, cleared: boolean, now: number): void => {
    const { x, y } = toPixels(exit.position);

    ctx.fillStyle = colors.exit;
    ctx.fillRect(x - 18, y - 18, 36, 36);
    ctx.fillStyle = colors.exitStep;
    for (let step = 0; step < 3; step += 1) {
      ctx.fillRect(x - 14 + step * 4, y - 12 + step * 9, 28 - step * 8, 5);
    }

    if (cleared) {
      ctx.globalAlpha = 0.3 + 0.2 * Math.sin(now / 200);
      ctx.fillRect(x - 22, y - 22, 44, 44);
      ctx.globalAlpha = 1;
    }
  };

  const drawDoor = (door: DoorState): void => {
    const px = door.position.x * TILE;
    const py = door.position.y * TILE;

    if (door.open) {
      ctx.strokeStyle = colors.door;
      ctx.lineWidth = 4;
      ctx.strokeRect(px + 4, py + 4, TILE - 8, TILE - 8);
      ctx.lineWidth = 1;
      return;
    }

    ctx.fillStyle = colors.door;
    ctx.fillRect(px + 2, py + 2, TILE - 4, TILE - 4);
    ctx.fillStyle = colors.doorPlank;
    for (let plank = 1; plank < 4; plank += 1) {
      ctx.fillRect(px + plank * 12, py + 4, 2, TILE - 8);
    }

    if (door.locked) {
      ctx.fillStyle = colors.lock;
      ctx.fillRect(px + TILE / 2 - 6, py + TILE / 2 - 1, 12, 10);
      ctx.strokeStyle = colors.lock;
      ctx.lineWidth = 2;
      ctx.strokeRect(px + TILE / 2 - 4, py + TILE / 2 - 7, 8, 7);
      ctx.lineWidth = 1;
    }
  };

  const drawLoot = (loot: LootState, now: number): void => {
    const { x, y } = toPixels(loot.position);
    const top = y + Math.round(Math.sin(now / 300 + loot.position.x) * 2);

    if (loot.kind === "key") {
      ctx.fillStyle = colors.key;
      ctx.fillRect(x - 12, top - 5, 9, 9);
      ctx.fillRect(x - 3, top - 2, 14, 3);
      ctx.fillRect(x + 8, top + 1, 3, 5);
      ctx.fillStyle = colors.floor;
      ctx.fillRect(x - 9, top - 2, 3, 3);
      return;
    }

    ctx.fillStyle = colors.glass;
    ctx.fillRect(x - 3, top - 12, 6, 5);
    ctx.fillStyle = colors.tonic;
    ctx.fillRect(x - 8, top - 7, 16, 16);
    ctx.fillStyle = colors.glass;
    ctx.fillRect(x - 5, top - 4, 3, 6);
  };

  const drawHealthBar = (centerX: number, top: number, health: number, maxHealth: number): void => {
    const width = 30;
    const ratio = Math.max(0, Math.min(1, health / maxHealth));

    ctx.fillStyle = colors.healthBack;
    ctx.fillRect(centerX - width / 2, top, width, 4);
    ctx.fillStyle = ratio > 0.35 ? colors.health : colors.healthLow;
    ctx.fillRect(centerX - width / 2, top, Math.round(width * ratio), 4);
  };

  const drawMonster = (monster: MonsterState): void => {
    const { x, y } = toPixels(monster.position);

    ctx.fillStyle = colors.monster;
    ctx.fillRect(x - 13, y - 13, 26, 26);
    ctx.fillStyle = colors.monsterEyes;
    ctx.fillRect(x - 7, y - 5, 5, 5);
    ctx.fillRect(x + 3, y - 5, 5, 5);
    drawHealthBar(x, y - 21, monster.health, monster.maxHealth);
  };

  const drawPlayer = (
    position: Vector2,
    player: PlayerState,
    color: string,
    faded: boolean,
  ): void => {
    const { x, y } = toPixels(position);

    ctx.globalAlpha = faded ? 0.45 : 1;

    if (player.health <= 0) {
      // Lying down, so a downed player reads as out of the fight at a glance.
      ctx.fillStyle = colors.downedPlayer;
      ctx.fillRect(x - 14, y + 2, 28, 12);
      ctx.fillStyle = colors.eyes;
      ctx.fillRect(x + 7, y + 5, 3, 3);
    } else {
      ctx.fillStyle = color;
      ctx.fillRect(x - 12, y - 14, 24, 28);
      ctx.fillStyle = colors.eyes;
      ctx.fillRect(x - 5, y - 7, 4, 4);
      ctx.fillRect(x + 4, y - 7, 4, 4);
      drawHealthBar(x, y - 22, player.health, PLAYER_MAX_HEALTH);
    }

    ctx.fillStyle = colors.label;
    ctx.font = "12px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(player.name, x, y + 28);
    ctx.globalAlpha = 1;
  };

  const drawSwings = (effects: Effects, now: number): void => {
    const reach = PLAYER_ATTACK_RANGE * TILE;
    const halfArc = Math.acos(PLAYER_ATTACK_ARC_COS);

    ctx.strokeStyle = colors.swing;
    ctx.lineWidth = 4;
    for (const swing of effects.swings) {
      const progress = (now - swing.startedAt) / SWING_MS;
      if (progress < 0 || progress >= 1) continue;

      const { x, y } = toPixels(swing.origin);
      const angle = Math.atan2(swing.heading.y, swing.heading.x);
      ctx.globalAlpha = 0.65 * (1 - progress);
      ctx.beginPath();
      ctx.arc(x, y, reach * (0.6 + 0.4 * progress), angle - halfArc, angle + halfArc);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;
  };

  const drawFloaters = (effects: Effects, now: number): void => {
    ctx.font = "bold 14px sans-serif";
    ctx.textAlign = "center";
    for (const floater of effects.floaters) {
      const progress = (now - floater.startedAt) / FLOATER_MS;
      if (progress < 0 || progress >= 1) continue;

      const { x, y } = toPixels(floater.position);
      ctx.globalAlpha = 1 - progress;
      ctx.fillStyle = floater.tone === "hurt" ? colors.hurt : colors.damage;
      ctx.fillText(floater.text, x, y - 26 - progress * 22);
    }
    ctx.globalAlpha = 1;
  };

  const drawPrompt = (interaction: Interaction): void => {
    const { x, y } = toPixels(interaction.position);
    const text = `E  ${interaction.label}`;

    ctx.font = "12px sans-serif";
    const width = ctx.measureText(text).width + 14;
    ctx.fillStyle = colors.promptBack;
    ctx.fillRect(x - width / 2, y - 46, width, 18);
    ctx.fillStyle = interaction.refusal ? colors.promptMuted : colors.prompt;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x, y - 37);
    ctx.textBaseline = "alphabetic";
  };

  function render(): void {
    const scene = getScene();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Fit the whole map in view and center it, so every party member sees the same framing.
    const columns = Math.max(1, ...scene.tiles.map((row) => row.length));
    const rows = Math.max(1, scene.tiles.length);
    const scale = Math.min(MAX_SCALE, cssWidth / (columns * TILE), cssHeight / (rows * TILE));
    const offsetX = (cssWidth - columns * TILE * scale) / 2;
    const offsetY = (cssHeight - rows * TILE * scale) / 2;
    ctx.setTransform(
      pixelRatio * scale,
      0,
      0,
      pixelRatio * scale,
      pixelRatio * offsetX,
      pixelRatio * offsetY,
    );
    ctx.imageSmoothingEnabled = false;

    scene.tiles.forEach((row, y) => {
      for (let x = 0; x < row.length; x += 1) drawTile(x, y, row[x] ?? "#");
    });

    const { dungeon } = scene;
    if (dungeon) {
      for (const exit of dungeon.exits) drawExit(exit, dungeon.cleared, scene.now);
      for (const door of dungeon.doors) drawDoor(door);
      for (const loot of dungeon.loot) if (!loot.pickedUp) drawLoot(loot, scene.now);
      for (const monster of dungeon.monsters) if (monster.alive) drawMonster(monster);
    }

    for (const player of scene.others) {
      drawPlayer(player.position, player, colors.remotePlayer, !player.connected);
    }
    if (scene.self) {
      drawPlayer(scene.localPosition, scene.self, colors.localPlayer, false);
    }

    drawSwings(scene.effects, scene.now);
    drawFloaters(scene.effects, scene.now);
    if (scene.interaction) drawPrompt(scene.interaction);
  }

  window.addEventListener("resize", resize);
  resize();

  return { canvas, render };
}
