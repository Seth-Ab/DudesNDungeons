import { TILE_SCALE } from "../../shared/constants/game.js";
import { MAP_PROP_SHADOWS, MAP_PROP_SIZES } from "../../shared/constants/scenery.js";
import { PLAYER_RADIUS, tileAt } from "../../shared/game/movement.js";
import type {
  ChestState,
  DoorState,
  DungeonMapState,
  DungeonState,
  LightSourceState,
  LootState,
  MapProp,
  MonsterState,
  PlayerState,
  SessionLocation,
  Vector2,
} from "../../shared/types/core.js";
import {
  doorOrientation,
  itemSprite,
  propSprite,
  type SpriteName,
} from "./tiles.js";
import {
  createLightShader,
  flickerFactor,
  hubAmbientDarkness,
  sceneLights,
  shadingTile,
} from "./lighting.js";
import {
  clampPlate,
  distanceToProp,
  labelMode,
  labelOpacity,
  safeArea,
  type Rect,
} from "./propLabels.js";
import { createTileLayer } from "./tileLayer.js";
import { loadTileset } from "./tileset.js";
import {
  monsterBarView,
  POPUP_RISE,
  type ActivePopup,
  type ActiveSwing,
  type DamagePopupKind,
} from "../state/combatFeedback.js";
import { isTileLit, type LitTileSet } from "../state/litTiles.js";
import { exitCaption, SEALED_EXIT_PROMPT } from "../state/runFlow.js";
import type { BowAim } from "../state/bowIndicator.js";
import type { PlacedEmote } from "../state/emotes.js";
import { drawEmoteBubbles } from "./emoteBubbles.js";
import { drawReadyPlates } from "./readyPlates.js";
import { drawDummyPlates, drawTrainingDummies } from "./trainingDummies.js";
import { createCharacterSprites, type DrawnPlayer } from "./characterSprites.js";
import { lookOf } from "./characters.js";
import { flameHaloTint, flameSwaps, isRecolouredFlame, lightFlameId } from "./flames.js";
import { TRAIL_PIXEL, trailPalette, trailPixels } from "./trails.js";

/**
 * Screen pixels per world unit.
 *
 * Down from the 48 a tile used to get, because a tile is no longer a world unit: at `TILE_SCALE` an
 * authored tile is a 4x4 block, so an authored tile still draws at 128px while the player, who did
 * not grow, is a fifth of the width of the corridor they stand in. That is the point of the change -
 * the dungeon is bigger around you, not merely drawn closer.
 *
 * It is also exactly twice `SPRITE_TILE_SIZE`, so a 16px sprite lands on a 2x pixel grid and the art
 * stays crisp. Moving this off a multiple of 16 puts the tiles back on fractional pixels.
 */
export const pixelsPerWorldUnit = 32;

/** The body the server collides a player with, in world units. Monsters are sized from it. */
const figureWidth = PLAYER_RADIUS * 2;

/** How far a seated figure is drawn below where it sits, in world units, so it reads as sitting. */
const SEATED_DROP = 0.2;

const colors = {
  floor: "#2d3033",
  wall: "#0e0f12",
  unknown: "#050609",
  // A prop's contact shadow: the cool near-black of the canopy's shade, fading out to its rim.
  contactShadow: "rgba(14, 10, 28, 0.55)",
  contactShadowEdge: "rgba(14, 10, 28, 0.34)",
  contactShadowClear: "rgba(14, 10, 28, 0)",
  grid: "#3a3329",
  monster: "#b8584c",
  rangedMonster: "#c9893f",
  chargerMonster: "#7d5a8c",
  stunnedMonster: "#8a8f94",
  projectile: "#ffb347",
  loot: "#d6a84c",
  chest: "#856a42",
  openChest: "#3b2f20",
  trapArmed: "#b5452f",
  trapSpent: "#4a3c36",
  plateIdle: "#5b6f8c",
  plateHeld: "#d9b44a",
  plateSolved: "#4f8a5b",
  door: "#8f6335",
  openDoor: "#3d3a2d",
  exit: "#6aa36f",
  light: "#f0c66a",
  label: "#f7f0da",
  areaBorder: "#6b5a3e",
  areaLabel: "#c9b184",
  gateLabel: "#9fd0a6",
  sealedLabel: "#d0806a",
  boss: "#8e2f3a",
  telegraph: "rgba(214, 74, 58, 0.4)",
  telegraphFlash: "rgba(255, 140, 110, 0.65)",
  telegraphEdge: "rgba(255, 120, 100, 0.8)",
  swingHit: "rgba(255, 236, 170, 0.55)",
  swingHitEdge: "rgba(255, 248, 210, 0.95)",
  swingMiss: "rgba(190, 200, 215, 0.22)",
  swingMissEdge: "rgba(190, 200, 215, 0.55)",
  swingImpact: "rgba(255, 244, 200, 0.8)",
  aimGhost: "rgba(244, 239, 224, 0.28)",
  aimLine: "#d9a441",
  aimFull: "#9fd8a8",
  aimMark: "#f4efe0",
  monsterBar: "#caa85a",
  monsterBarLow: "#d2503f",
};

const POPUP_COLORS: Record<DamagePopupKind, string> = {
  dealt: "#f4d27a",
  taken: "#ff6b5a",
  ally: "#cfd6dc",
};

/**
 * Flat fills, used for the frames before the tilesheet has decoded and if it never does. Remembered
 * tiles share the lit colours, because the lightmap shades them just as it shades the sprites.
 */
const tileColors: Record<string, string> = {
  "#": colors.wall,
  "+": colors.wall,
  " ": colors.unknown,
};

/** The lightmap's shade, as RGB. Close to `colors.unknown`, so full shade matches the void. */
const SHADE_RGB = [6, 7, 10] as const;

export interface Scene {
  dungeon: DungeonState;
  /**
   * What the server lit in the snapshot `dungeon` came from; every other discovered tile draws
   * dark. Null only for the offline preview, which has no server and draws everything as lit.
   */
  lit: LitTileSet | null;
  /** Locally predicted position for the player at this client, drawn ahead of the server. */
  localPosition: Vector2;
  self: PlayerState | null;
  others: PlayerState[];
  /** Which world this is. The hub is signposted; a dungeon is not. */
  location: SessionLocation | null;
  /** One line under the hub gate saying whether it will open. Null outside the hub. */
  gatePrompt: string | null;
  /** Damage numbers currently floating, positioned in world units. */
  popups: readonly ActivePopup[];
  /** Player swings currently animating, with the geometry the server resolved. */
  swings: readonly ActiveSwing[];
  /** Bows being drawn that this client can see, the local player's first. */
  bowAims: readonly BowAim[];
  /** Emote bubbles, each already pinned to where its emoter is drawn. */
  emotes: readonly PlacedEmote[];
  /** How far each recently struck training dummy leans, by id. A dummy at rest is absent. */
  dummyWobbles: ReadonlyMap<string, number>;
}

/**
 * Screen rectangles the HUD covers, measured from the panels themselves so the label-safe area
 * follows the layout at any window size. The whole minimap corner and notice stack count, toasts
 * included, not just the panels inside them. Re-measured at most every `HUD_MEASURE_INTERVAL_MS`: the
 * panels move only when they change size or the window does, and a layout read each frame is waste.
 */
const HUD_OBSTACLE_SELECTOR =
  ".hud__panel, .hud__corner, .hud__notices, .hud__hotbar, .hud__frames, .hud__draw";
const HUD_MEASURE_INTERVAL_MS = 250;

function measureHudObstacles(): Rect[] {
  const obstacles: Rect[] = [];
  for (const element of document.querySelectorAll(HUD_OBSTACLE_SELECTOR)) {
    const bounds = element.getBoundingClientRect();
    if (bounds.width > 0 && bounds.height > 0) {
      obstacles.push({ left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom });
    }
  }
  return obstacles;
}

export function createCanvasRenderer(
  getScene: () => Scene,
  getObstacles: () => readonly Rect[] = measureHudObstacles,
) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Canvas 2D context is unavailable.");
  }

  const ctx = context;
  canvas.className = "game-canvas";
  let viewportWidth = window.innerWidth;
  let viewportHeight = window.innerHeight;

  // Redrawn once the sheet arrives, so the first painted frame is not left flat until something
  // else happens to ask for a render.
  const tileset = loadTileset(() => render());
  const characters = createCharacterSprites(() => render());

  /**
   * Floor and wall sprites, stamped into cached chunks and blitted. A wall picks its cell from its
   * four neighbours, so a block of wall gets a lit lip wherever it meets floor, and a floor picks a
   * variant from its coordinates; both depend only on what is known of the map, so the chunks are
   * restamped when something is discovered rather than every frame. See `tileLayer.ts`.
   */
  const tileLayer = createTileLayer({
    tileset,
    createSurface: (size) => {
      const surface = document.createElement("canvas");
      surface.width = size;
      surface.height = size;
      const surfaceContext = surface.getContext("2d");
      if (!surfaceContext) throw new Error("Canvas 2D context is unavailable.");
      surfaceContext.imageSmoothingEnabled = false;
      return { image: surface, context: surfaceContext };
    },
  });

  const resize = (): void => {
    const pixelRatio = window.devicePixelRatio || 1;
    const bounds = canvas.getBoundingClientRect();
    const width = bounds.width > 0 ? bounds.width : window.innerWidth;
    const height = bounds.height > 0 ? bounds.height : window.innerHeight;
    viewportWidth = width;
    viewportHeight = height;

    canvas.width = Math.floor(width * pixelRatio);
    canvas.height = Math.floor(height * pixelRatio);
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    // Pixel art is resampled by hand, not by the browser. Reset after every transform change,
    // because the flag lives on the context and a fresh backing store clears it.
    ctx.imageSmoothingEnabled = false;
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

  /** Stamps a sprite over a `width` x `height` world-unit box centred on a world position. */
  const drawSprite = (
    name: SpriteName,
    center: Vector2,
    width: number,
    height: number,
    camera: Vector2,
  ): void => {
    const topLeft = worldToScreen({ x: center.x - width / 2, y: center.y - height / 2 }, camera);
    tileset.draw(
      ctx,
      name,
      topLeft.x,
      topLeft.y,
      width * pixelsPerWorldUnit,
      height * pixelsPerWorldUnit,
    );
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
   * The fallback for the frames before the sheet decodes. The masonry lines fall every `TILE_SCALE`
   * units, which is one authored tile: ruling every world tile would draw a grid four times finer
   * than anything the level was built from, and read as graph paper rather than as a floor. They
   * are drawn tile by tile alongside the fill rather than swept across the viewport, so they stop
   * where the player's knowledge of the map stops. Ruling the void would put a grid over space
   * nobody has seen.
   */
  const drawFlatTiles = (dungeon: DungeonState, camera: Vector2): void => {
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

  const carryLabel = (player: PlayerState): string =>
    player.carryingPlayerId ? `${player.name} [carrying]` : player.name;

  /**
   * A player as drawn this frame, or null for one still designing their character, who is not in
   * the world. Downed and disconnected players are drawn faded; a carried player is drawn where the
   * snapshot puts them, like anyone else. A seated player is the standing figure dropped a little
   * onto the seat, until the character sheet has a seated frame.
   */
  const drawnPlayer = (player: PlayerState, position: Vector2): DrawnPlayer | null => {
    const look = lookOf(player);
    return look === null
      ? null
      : {
          id: player.id,
          look,
          facing: player.facing,
          position: player.seatId === null ? position : { x: position.x, y: position.y + SEATED_DROP },
          label: carryLabel(player),
          faded: player.health <= 0 || !player.connected,
        };
  };

  /**
   * The cone a winding-up monster is about to strike. The outline marks the full area; the fill grows
   * outward as the wind-up elapses and the whole cone flashes as it nears landing, so a player can
   * read when to step out.
   */
  const drawTelegraph = (monster: MonsterState, center: Vector2): void => {
    const heading = Math.atan2(monster.facing.y, monster.facing.x);
    const halfArc = Math.acos(Math.min(Math.max(monster.hitArcCos, -1), 1));
    const reach = monster.hitRange * pixelsPerWorldUnit;
    const wedge = (radius: number): void => {
      ctx.beginPath();
      ctx.moveTo(center.x, center.y);
      ctx.arc(center.x, center.y, radius, heading - halfArc, heading + halfArc);
      ctx.closePath();
    };

    const flash = monster.windupProgress > 0.8;
    ctx.fillStyle = flash ? colors.telegraphFlash : colors.telegraph;
    wedge(reach * (flash ? 1 : monster.windupProgress));
    ctx.fill();
    ctx.strokeStyle = colors.telegraphEdge;
    ctx.lineWidth = 2;
    wedge(reach);
    ctx.stroke();
  };

  /**
   * A boss is the same placeholder drawn bigger, darker, and named, until it has art of its own.
   * Its name is the one monster label worth the clutter: it is the fight that holds the exit shut.
   */
  const drawMonster = (monster: MonsterState, camera: Vector2): void => {
    const center = worldToScreen(monster.position, camera);
    const side = figureWidth * (monster.boss ? 1.9 : 1.15) * pixelsPerWorldUnit;
    const eye = Math.max(2, side * 0.18);

    if (monster.action === "windingUp") drawTelegraph(monster, center);

    ctx.fillStyle = monster.boss
      ? colors.boss
      : monster.action === "stunned"
        ? colors.stunnedMonster
        : monster.behavior === "ranged"
          ? colors.rangedMonster
          : monster.behavior === "charger"
            ? colors.chargerMonster
            : colors.monster;
    ctx.fillRect(center.x - side / 2, center.y - side / 2, side, side);
    ctx.fillStyle = "#2b0f0f";
    ctx.fillRect(center.x - side * 0.22 - eye / 2, center.y - side * 0.12, eye, eye);
    ctx.fillRect(center.x + side * 0.22 - eye / 2, center.y - side * 0.12, eye, eye);

    const bar = monsterBarView(monster.health, monster.maxHealth);
    const barWidth = side * 1.15;
    const barHeight = monster.boss ? 6 : 5;
    const barY = center.y - side / 2 - 11;
    const barX = center.x - barWidth / 2;
    ctx.fillStyle = "#0b0b0b";
    ctx.fillRect(barX - 1, barY - 1, barWidth + 2, barHeight + 2);
    ctx.fillStyle = "#3a2323";
    ctx.fillRect(barX, barY, barWidth, barHeight);
    ctx.fillStyle = bar.low ? colors.monsterBarLow : colors.monsterBar;
    ctx.fillRect(barX, barY, barWidth * bar.ratio, barHeight);

    if (monster.boss) {
      ctx.fillStyle = colors.sealedLabel;
      ctx.font = "13px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(monster.name, center.x, barY - 6);
    }
  };

  /**
   * The weapon trail a swinger wears, in art pixels over their slash. `trailPixels` keeps every
   * pixel inside the swing's reach and arc, so a trail never shows more reach than the hit had.
   */
  const drawTrail = (swing: ActiveSwing, trailId: string | null, camera: Vector2): void => {
    const palette = trailPalette(trailId);
    if (!palette) return;
    for (const pixel of trailPixels(swing, palette)) {
      const topLeft = worldToScreen(pixel, camera);
      const bottomRight = worldToScreen({ x: pixel.x + TRAIL_PIXEL, y: pixel.y + TRAIL_PIXEL }, camera);
      const left = Math.round(topLeft.x);
      const top = Math.round(topLeft.y);
      ctx.globalAlpha = pixel.alpha;
      ctx.fillStyle = pixel.colour;
      ctx.fillRect(left, top, Math.round(bottomRight.x) - left, Math.round(bottomRight.y) - top);
    }
    ctx.globalAlpha = 1;
  };

  /**
   * A slash sweeps across the arc out to the swing's exact reach, then fades; a hit is brighter and
   * ends in a flash on the target. The arc never extends past the server's range. A swinger's trail
   * is drawn over their slash.
   */
  const drawSwings = (swings: readonly ActiveSwing[], players: readonly PlayerState[], camera: Vector2): void => {
    for (const swing of swings) {
      const trailId = players.find((player) => player.id === swing.attackerId)?.cosmetics.trail ?? null;
      const center = worldToScreen(swing.origin, camera);
      const reach = swing.range * pixelsPerWorldUnit;
      const sweep = Math.min(1, swing.progress * 2);
      const from = swing.heading - swing.halfArc;
      const to = swing.heading + swing.halfArc;
      const edge = from + (to - from) * sweep;
      ctx.globalAlpha = Math.max(0, 1 - swing.progress);
      ctx.fillStyle = swing.hit ? colors.swingHit : colors.swingMiss;
      ctx.beginPath();
      ctx.moveTo(center.x, center.y);
      ctx.arc(center.x, center.y, reach, from, edge);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = swing.hit ? colors.swingHitEdge : colors.swingMissEdge;
      ctx.lineWidth = swing.hit ? 3 : 2;
      ctx.beginPath();
      ctx.arc(center.x, center.y, reach, from, edge);
      ctx.stroke();

      if (swing.impact) {
        const at = worldToScreen(swing.impact, camera);
        ctx.fillStyle = colors.swingImpact;
        ctx.beginPath();
        ctx.arc(at.x, at.y, (0.3 + 0.4 * swing.progress) * pixelsPerWorldUnit, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      drawTrail(swing, trailId, camera);
    }
    ctx.globalAlpha = 1;
  };

  /**
   * A drawn bow's aim line. A faint line marks the full-draw reach with a tick across it; the solid
   * line grows to the range an arrow would fly now. At full draw it turns green, thickens and ends
   * in a ring, so the state shows in shape as well as colour. Walls are ignored on purpose: the
   * line is the intended range, and the server decides what the arrow hits.
   */
  const drawBowAims = (aims: readonly BowAim[], camera: Vector2): void => {
    for (const aim of aims) {
      const from = worldToScreen(aim.origin, camera);
      const dx = Math.cos(aim.heading);
      const dy = Math.sin(aim.heading);
      const at = (distance: number) => ({
        x: from.x + dx * distance * pixelsPerWorldUnit,
        y: from.y + dy * distance * pixelsPerWorldUnit,
      });
      const tip = at(aim.length);
      const end = at(aim.fullLength);
      ctx.globalAlpha = aim.own ? 1 : 0.6;
      ctx.lineCap = "round";

      ctx.strokeStyle = colors.aimGhost;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      ctx.strokeStyle = colors.aimMark;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(end.x - dy * 6, end.y + dx * 6);
      ctx.lineTo(end.x + dy * 6, end.y - dx * 6);
      ctx.stroke();

      ctx.strokeStyle = aim.full ? colors.aimFull : colors.aimLine;
      ctx.lineWidth = aim.full ? 4 : 2.5;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(tip.x, tip.y);
      ctx.stroke();

      ctx.fillStyle = aim.full ? colors.aimFull : colors.aimLine;
      ctx.beginPath();
      ctx.arc(tip.x, tip.y, aim.full ? 5 : 3, 0, Math.PI * 2);
      ctx.fill();
      if (aim.full) {
        ctx.strokeStyle = colors.aimMark;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(tip.x, tip.y, 9, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.lineCap = "butt";
  };

  /** Numbers rise and fade; red when the local player is hit, gold for their own hits. */
  const drawPopups = (popups: readonly ActivePopup[], camera: Vector2): void => {
    ctx.textAlign = "center";
    ctx.lineJoin = "round";
    for (const popup of popups) {
      const at = worldToScreen(
        { x: popup.position.x, y: popup.position.y - POPUP_RISE * popup.progress - 0.9 },
        camera,
      );
      ctx.globalAlpha = Math.max(0, 1 - popup.progress * popup.progress);
      ctx.font = popup.kind === "ally" ? "bold 14px sans-serif" : "bold 18px sans-serif";
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#0b0b0b";
      ctx.strokeText(popup.text, at.x, at.y);
      ctx.fillStyle = POPUP_COLORS[popup.kind];
      ctx.fillText(popup.text, at.x, at.y);
    }
    ctx.globalAlpha = 1;
  };

  /**
   * A door is drawn across its whole opening, which is the span the server collides against.
   *
   * A closed door tiles its leaf over every world tile of that span, because at `TILE_SCALE` the
   * span is four tiles and one sprite stretched across it would be drawn at four times its size.
   * An open one is two jambs at the ends, so the floor the party is about to cross shows through.
   */
  const drawDoor = (map: DungeonMapState, door: DoorState, camera: Vector2): void => {
    const horizontal =
      doorOrientation(
        (x, y) => tileAt(map, x, y),
        door.position.x,
        door.position.y,
        door.size,
      ) === "h";
    const half = door.size / 2;
    const cells = Math.max(1, Math.round(door.size));
    const first = door.position.x - half + 0.5;
    const firstRow = door.position.y - half + 0.5;

    if (!tileset.ready) {
      drawWorldRect(door.position, door.size, door.open ? colors.openDoor : colors.door, camera);
      return;
    }

    if (door.open) {
      const jamb = horizontal ? "door-jamb-h" : "door-jamb-v";
      for (let index = 0; index < cells; index += 1) {
        const near = horizontal
          ? { x: first, y: firstRow + index }
          : { x: first + index, y: firstRow };
        const far = horizontal
          ? { x: first + cells - 1, y: firstRow + index }
          : { x: first + index, y: firstRow + cells - 1 };
        drawSprite(jamb, near, 1, 1, camera);
        drawSprite(jamb, far, 1, 1, camera);
      }
      return;
    }

    const leaf = horizontal ? "door-closed-h" : "door-closed-v";
    for (let row = 0; row < cells; row += 1) {
      for (let column = 0; column < cells; column += 1) {
        drawSprite(leaf, { x: first + column, y: firstRow + row }, 1, 1, camera);
      }
    }

    if (door.lock !== null) {
      drawSprite("door-lock", door.position, 2, 2, camera);
    }
  };

  /**
   * A warm halo under a light source, so a torch reads as the thing lighting the room.
   *
   * Drawn before the lightmap rather than after, so a torch at the edge of its light is shaded
   * like everything else. This is decoration on top of the server's
   * lighting, not a second opinion about it: what a player can see is still decided server-side.
   */
  const drawLightGlow = (light: LightSourceState, camera: Vector2, scene: Scene, now: number): void => {
    const hub = scene.location === "hub";
    const waver = flickerFactor(light.id, now, light.flicker ?? 0);
    const center = worldToScreen(light.position, camera);
    // A dungeon torch's halo stops at six units however far it lights. The hub's lanterns are a
    // pool on open ground, so the halo follows the light's reach.
    const radius = (hub ? light.radius : Math.min(light.radius, 6)) * waver * pixelsPerWorldUnit;
    const red = light.tint === "red";
    const gradient = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, radius);
    if (hub) {
      gradient.addColorStop(0, red ? "rgba(255, 70, 50, 0.34)" : "rgba(255, 190, 90, 0.42)");
      gradient.addColorStop(0.5, red ? "rgba(190, 40, 30, 0.14)" : "rgba(235, 135, 50, 0.16)");
      gradient.addColorStop(1, red ? "rgba(120, 20, 20, 0)" : "rgba(160, 70, 30, 0)");
    } else {
      gradient.addColorStop(0, "rgba(240, 168, 60, 0.26)");
      gradient.addColorStop(0.5, "rgba(194, 85, 29, 0.10)");
      gradient.addColorStop(1, "rgba(123, 31, 20, 0)");
    }

    ctx.save();
    // Added to the ground rather than laid over it, so a pool warms and brightens what is beneath.
    if (hub) ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = gradient;
    ctx.fillRect(center.x - radius, center.y - radius, radius * 2, radius * 2);
    ctx.restore();
  };

  /**
   * A carried torch's flame in its bearer's cosmetic flame, with a faint halo of the same colour.
   * Only the sprite and halo change: the light's reach and the lightmap are the server's.
   */
  const drawCarriedFlame = (light: LightSourceState, at: Vector2, scene: Scene, camera: Vector2): void => {
    const flameId = lightFlameId(light, scene.self ? [...scene.others, scene.self] : scene.others);
    if (!isRecolouredFlame(flameId)) {
      drawSprite("torch-flame", at, 0.7, 0.7, camera);
      return;
    }

    const center = worldToScreen(at, camera);
    const radius = 1.2 * pixelsPerWorldUnit;
    const halo = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, radius);
    halo.addColorStop(0, flameHaloTint(flameId)!);
    halo.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = halo;
    ctx.fillRect(center.x - radius, center.y - radius, radius * 2, radius * 2);

    const size = 0.7 * pixelsPerWorldUnit;
    tileset.drawSwapped(ctx, "torch-flame", flameId!, flameSwaps(flameId), center.x - size / 2, center.y - size / 2, size, size);
  };

  const drawLightSource = (light: LightSourceState, camera: Vector2, scene: Scene, now: number): void => {
    if (!tileset.ready) {
      if (light.fixture !== "none") {
        drawWorldRect(light.position, light.kind === "fixed" ? 0.75 : 0.5, colors.light, camera);
      }
      return;
    }

    switch (light.kind) {
      case "fixed":
        if (light.fixture === "none") break;
        if (light.fixture === "campfire") {
          drawSprite("campfire-logs", light.position, 1, 1, camera);
          // The flame grows and shrinks with the same waver as the light it feeds.
          const flame = 0.9 + 0.6 * flickerFactor(light.id, now, light.flicker ?? 0);
          drawSprite("torch-flame", { x: light.position.x, y: light.position.y - 0.5 }, flame, flame, camera);
          break;
        }
        // Two tiles tall and standing on its own tile, so the flame is above the floor the light
        // was authored on rather than buried in it.
        drawSprite("torch-pillar", { x: light.position.x, y: light.position.y - 0.5 }, 1, 2, camera);
        break;
      case "carriedTorch":
        // Held above the head, because the figure is drawn after this and would cover it.
        drawCarriedFlame(light, { x: light.position.x, y: light.position.y - 0.8 }, scene, camera);
        break;
      case "monsterGlow":
        drawSprite("glow-mote", light.position, 1, 1, camera);
        break;
      case "flare":
        drawSprite("flare-lit", light.position, 1, 1, camera);
        break;
    }
  };

  const drawLoot = (loot: LootState, camera: Vector2): void => {
    if (!tileset.ready) {
      drawWorldRect(loot.position, 0.55, colors.loot, camera);
      return;
    }

    // A whole world unit rather than the 0.55 the flat marker used. Loot sits at the centre of a
    // 4x4 block now, and a marker half a tile across was a speck in the middle of a large room.
    drawSprite(itemSprite(loot), loot.position, 1, 1, camera);
  };

  /** Two world units across, twice a loot sprite, with a padlock on its face while it is locked. */
  const drawChest = (chest: ChestState, camera: Vector2): void => {
    if (!tileset.ready) {
      drawWorldRect(chest.position, 1.4, chest.opened ? colors.openChest : colors.chest, camera);
      return;
    }

    drawSprite(chest.opened ? "chest-open" : "chest-closed", chest.position, 2, 2, camera);
    if (chest.locked) drawSprite("door-lock", chest.position, 1, 1, camera);
  };

  /**
   * Scenery: fountains, stalls, trees, the gate. Collision is the tiles beneath, so this is only a
   * picture. Drawn by the bottom edge, top to bottom, so a tree in front overlaps the one behind it.
   */
  const drawProps = (props: readonly MapProp[], camera: Vector2): void => {
    if (!tileset.ready || props.length === 0) return;

    // Every shadow before any prop, so one never falls across a neighbour's sprite.
    for (const prop of props) drawContactShadow(prop, camera);

    // A hanging lantern is in front of the awning it hangs from, though its bottom edge is higher.
    const bottom = (prop: MapProp): number =>
      prop.kind === "hanging-lantern" ? 1e9 : prop.y + MAP_PROP_SIZES[prop.kind].tilesHigh;
    for (const prop of [...props].sort((a, b) => bottom(a) - bottom(b))) {
      const size = MAP_PROP_SIZES[prop.kind];
      const topLeft = worldToScreen({ x: prop.x - 0.5, y: prop.y - 0.5 }, camera);
      const width = size.tilesWide * pixelsPerWorldUnit;
      const height = size.tilesHigh * pixelsPerWorldUnit;
      if (
        topLeft.x > viewportWidth ||
        topLeft.y > viewportHeight ||
        topLeft.x + width < 0 ||
        topLeft.y + height < 0
      ) {
        continue;
      }
      tileset.draw(ctx, propSprite(prop.kind, prop.tint, prop.facing), topLeft.x, topLeft.y, width, height);
    }
  };

  /**
   * A soft ellipse of cool shade on the ground under a prop, from `MAP_PROP_SHADOWS`, so it sits on
   * the floor instead of floating over it. Densest at the middle and gone at the rim.
   */
  const drawContactShadow = (prop: MapProp, camera: Vector2): void => {
    const shadow = MAP_PROP_SHADOWS[prop.kind];
    if (!shadow) return;

    const centre = worldToScreen({ x: prop.x - 0.5 + shadow.x, y: prop.y - 0.5 + shadow.y }, camera);
    const radiusX = shadow.rx * pixelsPerWorldUnit;
    const radiusY = shadow.ry * pixelsPerWorldUnit;
    if (
      centre.x - radiusX > viewportWidth ||
      centre.y - radiusY > viewportHeight ||
      centre.x + radiusX < 0 ||
      centre.y + radiusY < 0
    ) {
      return;
    }

    ctx.save();
    ctx.translate(centre.x, centre.y);
    ctx.scale(1, radiusY / radiusX);
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, radiusX);
    gradient.addColorStop(0, colors.contactShadow);
    gradient.addColorStop(0.55, colors.contactShadowEdge);
    gradient.addColorStop(1, colors.contactShadowClear);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, radiusX, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  /**
   * Signage: what the gate is waiting for.
   *
   * Drawn after the lightmap, unlike most labels, because it is the one thing in the hub a player
   * needs to read from across the room. Area names are gone; a prop names itself as you approach
   * it (see `drawPropLabels`).
   */
  const drawSigns = (scene: Scene, camera: Vector2): void => {
    ctx.textAlign = "center";

    for (const exit of scene.dungeon.exits) {
      const center = worldToScreen(exit.position, camera);
      const caption = exitCaption(scene.location, exit);
      // Above the stairs rather than below them. Below is where a player stands to use them, and
      // the caption was drawn straight through their own name the moment they arrived.
      const captionY = center.y - (TILE_SCALE / 2) * pixelsPerWorldUnit - 8;

      ctx.fillStyle = exit.sealed ? colors.sealedLabel : colors.gateLabel;
      ctx.font = "14px sans-serif";
      ctx.fillText(caption, center.x, captionY);

      const prompt =
        scene.location === "hub" ? scene.gatePrompt : exit.sealed ? SEALED_EXIT_PROMPT : null;
      if (prompt) {
        ctx.fillStyle = colors.label;
        ctx.font = "12px sans-serif";
        ctx.fillText(prompt, center.x, captionY - 16);
      }
    }
  };

  let safeLabelArea: Rect = { left: 0, top: 0, right: 0, bottom: 0 };
  let safeLabelAreaAt = Number.NEGATIVE_INFINITY;
  let safeLabelAreaSize = "";

  /** The part of the screen the HUD leaves free, re-measured when the window changes or on a timer. */
  const labelArea = (now: number): Rect => {
    const size = `${viewportWidth}x${viewportHeight}`;
    if (size !== safeLabelAreaSize || now - safeLabelAreaAt > HUD_MEASURE_INTERVAL_MS) {
      safeLabelArea = safeArea(
        { left: 0, top: 0, right: viewportWidth, bottom: viewportHeight },
        getObstacles(),
      );
      safeLabelAreaAt = now;
      safeLabelAreaSize = size;
    }
    return safeLabelArea;
  };

  /**
   * Names for the hub's props, shown as the player nears them: a full plate within a few tiles, a
   * small icon beyond that for a stall, and nothing for the rest. Every plate is held inside the
   * part of the screen the HUD leaves free, so none is ever drawn under a panel.
   *
   * Drawn after the lightmap so a name stays readable in the hub's shade. Hub only: a dungeon's
   * props, if it ever has any, would otherwise name rooms the party has not explored.
   */
  const drawPropLabels = (scene: Scene, camera: Vector2, now: number): void => {
    if (scene.location !== "hub" || !scene.self) return;

    const area = labelArea(now);
    ctx.save();
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = "14px sans-serif";

    for (const prop of scene.dungeon.map.props ?? []) {
      if (!prop.label) continue;

      const distance = distanceToProp(prop, scene.localPosition);
      const mode = labelMode(prop.kind, distance);
      const opacity = labelOpacity(distance);
      if (mode === "hidden" && opacity.plate <= 0) continue;

      const size = MAP_PROP_SIZES[prop.kind];
      const anchor = worldToScreen(
        { x: prop.x - 0.5 + size.tilesWide / 2, y: prop.y - 0.5 },
        camera,
      );

      if (opacity.plate > 0) {
        const width = ctx.measureText(prop.label).width + 20;
        const height = 26;
        const { left, top } = clampPlate({ x: anchor.x, y: anchor.y - 18 }, width, height, area);

        ctx.globalAlpha = opacity.plate;
        ctx.fillStyle = "rgba(20, 17, 14, 0.78)";
        ctx.beginPath();
        ctx.roundRect(left, top, width, height, 6);
        ctx.fill();
        ctx.fillStyle = colors.label;
        ctx.fillText(prop.label, left + 10, top + height / 2 + 1);
      }

      if (mode !== "full" && opacity.icon > 0) {
        const { left, top } = clampPlate({ x: anchor.x, y: anchor.y - 12 }, 16, 16, area);

        ctx.globalAlpha = opacity.icon;
        ctx.fillStyle = "rgba(20, 17, 14, 0.78)";
        ctx.beginPath();
        ctx.arc(left + 8, top + 8, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = colors.light;
        ctx.beginPath();
        ctx.arc(left + 8, top + 8, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  };

  // One pixel per world tile, refilled every frame and stretched over the screen.
  const lightmap = document.createElement("canvas");
  const lightmapContext = lightmap.getContext("2d");
  const shadeTiles = createLightShader();
  /** The pixel buffer behind the lightmap, kept between frames and replaced only when the screen size changes. */
  let lightImage: ImageData | null = null;

  /**
   * Shades the frame by the server's lighting: tiles the snapshot lit by their distance from a light,
   * and remembered and unseen ones solid black.
   *
   * Drawn as one image of one pixel per tile and stretched with smoothing on, so the falloff is a
   * gradient rather than a staircase of square tiles. Pixel centres land on tile centres, so the
   * blend runs between neighbouring tiles and stops within half a tile of any wall that blocked
   * the light.
   */
  const drawLightmap = (scene: Scene, camera: Vector2, now: number): void => {
    if (!lightmapContext) return;

    const { map } = scene.dungeon;
    const lights = sceneLights(
      scene.dungeon.lightSources,
      scene.self ? { id: scene.self.id, position: scene.localPosition } : null,
      scene.others,
      now,
    );
    // A tile of slack past each edge, so the smoothing never clamps against the border on screen.
    const halfX = viewportWidth / 2 / pixelsPerWorldUnit;
    const halfY = viewportHeight / 2 / pixelsPerWorldUnit;
    const minX = Math.floor(camera.x - halfX) - 1;
    const minY = Math.floor(camera.y - halfY) - 1;
    const columns = Math.ceil(camera.x + halfX) + 1 - minX + 1;
    const rows = Math.ceil(camera.y + halfY) + 1 - minY + 1;

    if (lightmap.width !== columns || lightmap.height !== rows) {
      lightmap.width = columns;
      lightmap.height = rows;
    }

    if (lightImage === null || lightImage.width !== columns || lightImage.height !== rows) {
      lightImage = lightmapContext.createImageData(columns, rows);
      // The shade colour never changes; only the alpha channel is rewritten each frame.
      const [red, green, blue] = SHADE_RGB;
      for (let offset = 0; offset < lightImage.data.length; offset += 4) {
        lightImage.data[offset] = red;
        lightImage.data[offset + 1] = green;
        lightImage.data[offset + 2] = blue;
      }
    }

    const { lit } = scene;
    const readTile =
      lit === null
        ? (x: number, y: number) => tileAt(map, x, y)
        : (x: number, y: number) => shadingTile(tileAt(map, x, y), isTileLit(lit, map, x, y));
    // The hub has a light floor and a forest vignette; a dungeon's unlit-but-visible tiles stay black.
    const ambient =
      scene.location === "hub"
        ? (x: number, y: number) => hubAmbientDarkness(x, y, map.width, map.height)
        : undefined;
    shadeTiles(lightImage.data, columns, rows, minX, minY, readTile, lights, ambient);

    lightmapContext.putImageData(lightImage, 0, 0);

    const topLeft = worldToScreen({ x: minX - 0.5, y: minY - 0.5 }, camera);
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(
      lightmap,
      topLeft.x,
      topLeft.y,
      columns * pixelsPerWorldUnit,
      rows * pixelsPerWorldUnit,
    );
    ctx.restore();
  };

  function render(): void {
    const scene = getScene();
    // Wall clock rather than the page's timer, so every client's flames waver together.
    const now = Date.now();
    const camera = scene.self
      ? scene.localPosition
      : { x: scene.dungeon.map.width / 2, y: scene.dungeon.map.height / 2 };

    // Undiscovered space, and anything outside the window this snapshot carried, is simply black.
    ctx.fillStyle = colors.unknown;
    ctx.fillRect(0, 0, viewportWidth, viewportHeight);

    if (tileset.ready) {
      tileLayer.sync(scene.dungeon.map, scene.location ?? "none");
      const halfX = viewportWidth / 2 / pixelsPerWorldUnit;
      const halfY = viewportHeight / 2 / pixelsPerWorldUnit;
      tileLayer.draw(
        ctx,
        {
          minX: Math.floor(camera.x - halfX),
          maxX: Math.ceil(camera.x + halfX),
          minY: Math.floor(camera.y - halfY),
          maxY: Math.ceil(camera.y + halfY),
        },
        (x, y) => worldToScreen({ x, y }, camera),
        pixelsPerWorldUnit,
      );
    } else {
      drawFlatTiles(scene.dungeon, camera);
    }

    drawProps(scene.dungeon.map.props ?? [], camera);

    // Stairs after the scenery, so a gate frames them, and before everything that stands on them.
    scene.dungeon.exits.forEach((exit) =>
      tileset.ready
        ? drawSprite("exit-stairs", exit.position, TILE_SCALE, TILE_SCALE, camera)
        : drawWorldRect(exit.position, 1.6, colors.exit, camera),
    );
    scene.dungeon.doors.forEach((door) => drawDoor(scene.dungeon.map, door, camera));
    // Placeholder footprints until trap art exists; a spent trap is drawn dull so a party can see
    // which plates are safe to cross.
    scene.dungeon.traps.forEach((trap) =>
      drawWorldRect(trap.position, 1.1, trap.phase === "armed" ? colors.trapArmed : colors.trapSpent, camera),
    );
    // Placeholder plates until puzzle art exists: blue while free, gold while held, green once solved.
    scene.dungeon.puzzles.forEach((puzzle) =>
      puzzle.plates.forEach((plate) =>
        drawWorldRect(
          plate.position,
          1.4,
          puzzle.phase === "solved" ? colors.plateSolved : plate.held ? colors.plateHeld : colors.plateIdle,
          camera,
        ),
      ),
    );
    // The hub's ready plates, lit in the colour of whoever holds each.
    drawReadyPlates(
      ctx,
      scene.dungeon.map.readyPlates ?? [],
      scene.self ? [...scene.others, scene.self] : scene.others,
      (position) => worldToScreen(position, camera),
      pixelsPerWorldUnit,
    );
    // Before loot, so whatever a chest spilled is drawn on the floor in front of it.
    scene.dungeon.chests.forEach((chest) => drawChest(chest, camera));
    // Every halo before any flame: a hub halo is added to what is under it, and one drawn after a
    // neighbouring flame would wash that flame out to white.
    if (tileset.ready) scene.dungeon.lightSources.forEach((light) => drawLightGlow(light, camera, scene, now));
    scene.dungeon.lightSources.forEach((light) => drawLightSource(light, camera, scene, now));
    scene.dungeon.loot.filter((loot) => !loot.pickedUp).forEach((loot) => drawLoot(loot, camera));
    scene.dungeon.monsters
      .filter((monster) => monster.alive)
      .forEach((monster) => drawMonster(monster, camera));
    const toScreen = (position: Vector2): Vector2 => worldToScreen(position, camera);
    drawTrainingDummies(ctx, scene.dungeon.dummies, scene.dummyWobbles, toScreen, pixelsPerWorldUnit);
    // Placeholder bolts until projectile art exists.
    scene.dungeon.projectiles.forEach((bolt) => {
      const center = worldToScreen(bolt.position, camera);
      ctx.fillStyle = colors.projectile;
      ctx.beginPath();
      ctx.arc(center.x, center.y, bolt.radius * pixelsPerWorldUnit, 0, Math.PI * 2);
      ctx.fill();
    });

    const players = [
      ...scene.others.map((player) => drawnPlayer(player, player.position)),
      scene.self ? drawnPlayer(scene.self, scene.localPosition) : null,
    ].filter((player): player is DrawnPlayer => player !== null);
    characters.draw(ctx, players, toScreen, pixelsPerWorldUnit, performance.now());

    drawLightmap(scene, camera, now);
    drawPropLabels(scene, camera, now);
    drawSigns(scene, camera);
    drawSwings(scene.swings, scene.self ? [...scene.others, scene.self] : scene.others, camera);
    drawBowAims(scene.bowAims, camera);
    drawDummyPlates(ctx, scene.dungeon.dummies, toScreen);
    drawPopups(scene.popups, camera);
    drawEmoteBubbles(ctx, scene.emotes, (position) => worldToScreen(position, camera));
  }

  window.addEventListener("resize", resize);
  resize();

  return { canvas, render, resize };
}
