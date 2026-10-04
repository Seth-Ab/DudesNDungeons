import { PLAYER_TORCH_LIGHT_RADIUS, TILE_SCALE } from "../../shared/constants/game.js";
import { PLAYER_RADIUS, tileAt } from "../../shared/game/movement.js";
import type {
  DoorState,
  DungeonMapState,
  DungeonState,
  ItemKind,
  LightSourceState,
  LootState,
  MonsterState,
  PlayerState,
  RoomState,
  SessionLocation,
  Vector2,
} from "../../shared/types/core.js";
import {
  doorOrientation,
  floorSprite,
  tileLook,
  wallMask,
  wallSprite,
  UNKNOWN,
  type SpriteName,
} from "./tiles.js";
import { loadTileset } from "./tileset.js";

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
};

/** Flat fills, used for the frames before the tilesheet has decoded and if it never does. */
const tileColors: Record<string, string> = {
  "#": colors.wall,
  "+": colors.discoveredWall,
  ",": colors.discoveredFloor,
  " ": colors.unknown,
};

/**
 * Loot sprite per item kind. Exhaustive rather than defaulted: a new `itemKind` should fail the
 * client build and get its own art, not quietly spawn on the floor wearing something else's.
 */
const lootSprites: Record<ItemKind, SpriteName> = {
  key: "loot-key",
  tonic: "loot-tonic",
  ward: "loot-ward",
  skillScroll: "loot-skill-scroll",
  torch: "loot-torch",
};

export interface Scene {
  dungeon: DungeonState;
  /** Locally predicted position for the player at this client, drawn ahead of the server. */
  localPosition: Vector2;
  self: PlayerState | null;
  others: PlayerState[];
  /** Which world this is. The hub is signposted; a dungeon is not. */
  location: SessionLocation | null;
  /** One line under the hub gate saying whether it will open. Null outside the hub. */
  gatePrompt: string | null;
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

  // Redrawn once the sheet arrives, so the first painted frame is not left flat until something
  // else happens to ask for a render.
  const tileset = loadTileset(() => render());

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
    dim = false,
  ): void => {
    const topLeft = worldToScreen({ x: center.x - width / 2, y: center.y - height / 2 }, camera);
    tileset.draw(
      ctx,
      name,
      topLeft.x,
      topLeft.y,
      width * pixelsPerWorldUnit,
      height * pixelsPerWorldUnit,
      dim,
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
   * Stamps a floor or wall sprite for every tile on screen.
   *
   * A wall picks its cell from its four neighbours, so a block of wall gets a lit lip wherever it
   * meets floor. That is what the authored 4x4 block buys here: the interior world tiles of a block
   * come out plain and only its rim is drawn as an edge, without anybody authoring a rim.
   *
   * Floors pick a variant from their coordinates. At this scale a sparse hall is a couple of
   * thousand tiles, and one repeated flagstone across all of it reads as wallpaper.
   */
  const drawTileSprites = (dungeon: DungeonState, camera: Vector2): void => {
    const { map } = dungeon;
    const { minX, maxX, minY, maxY } = visibleTileRange(dungeon, camera);
    const readTile = (x: number, y: number): string | null => tileAt(map, x, y);

    for (let y = minY; y <= maxY; y += 1) {
      const row = map.tiles[y - map.originY];
      if (row === undefined) continue;

      for (let x = minX; x <= maxX; x += 1) {
        const look = tileLook(row[x - map.originX] ?? UNKNOWN);
        if (look === null) continue;

        const sprite =
          look.surface === "wall" ? wallSprite(wallMask(readTile, x, y)) : floorSprite(x, y);
        const topLeft = worldToScreen({ x: x - 0.5, y: y - 0.5 }, camera);
        tileset.draw(
          ctx,
          sprite,
          topLeft.x,
          topLeft.y,
          pixelsPerWorldUnit,
          pixelsPerWorldUnit,
          look.dim,
        );
      }
    }
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

    if (door.locked) {
      drawSprite("door-lock", door.position, 2, 2, camera);
    }
  };

  /**
   * A warm halo under a light source, so a torch reads as the thing lighting the room.
   *
   * Drawn before the darkness mask rather than after, so a torch at the edge of the screen is
   * knocked back by distance like everything else. This is decoration on top of the server's
   * lighting, not a second opinion about it: what a player can see is still decided server-side.
   */
  const drawLightGlow = (light: LightSourceState, camera: Vector2): void => {
    const center = worldToScreen(light.position, camera);
    const radius = Math.min(light.radius, 6) * pixelsPerWorldUnit;
    const gradient = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, radius);
    gradient.addColorStop(0, "rgba(240, 168, 60, 0.26)");
    gradient.addColorStop(0.5, "rgba(194, 85, 29, 0.10)");
    gradient.addColorStop(1, "rgba(123, 31, 20, 0)");

    ctx.fillStyle = gradient;
    ctx.fillRect(center.x - radius, center.y - radius, radius * 2, radius * 2);
  };

  const drawLightSource = (light: LightSourceState, camera: Vector2): void => {
    if (!tileset.ready) {
      drawWorldRect(light.position, light.kind === "fixed" ? 0.75 : 0.5, colors.light, camera);
      return;
    }

    drawLightGlow(light, camera);

    switch (light.kind) {
      case "fixed":
        // Two tiles tall and standing on its own tile, so the flame is above the floor the light
        // was authored on rather than buried in it.
        drawSprite("torch-pillar", { x: light.position.x, y: light.position.y - 0.5 }, 1, 2, camera);
        break;
      case "carriedTorch":
        // Held above the head, because the figure is drawn after this and would cover it.
        drawSprite("torch-flame", { x: light.position.x, y: light.position.y - 0.8 }, 0.7, 0.7, camera);
        break;
      case "monsterGlow":
        drawSprite("glow-mote", light.position, 1, 1, camera);
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
    drawSprite(lootSprites[loot.kind], loot.position, 1, 1, camera);
  };

  /**
   * The hub's named areas, drawn from the room metadata the snapshot already carries.
   *
   * The hub is one open room in `content/dungeons/hub.json`: its Quest Gallery, Strategy Hearth,
   * Torch Supply and Dungeon Gate are room records over an empty rectangle, because the authored
   * tile alphabet is `#` and `.` and `AGENTS.md` keeps it that way so backend and renderer work
   * stay independent. Marking them out here is what turns that data into a place, without a new
   * tile character and the content, collision, protocol and renderer change one would cost.
   *
   * Hub only, and not because a dungeon has nothing to label: a room is discovered the moment any
   * part of it is lit, so outlining one would draw its full extent from the first corner a player
   * sees. In the dark that is the shape of the room they have not explored yet.
   */
  const drawAreas = (rooms: readonly RoomState[], camera: Vector2): void => {
    for (const room of rooms) {
      const topLeft = worldToScreen({ x: room.x - 0.5, y: room.y - 0.5 }, camera);
      const width = room.width * pixelsPerWorldUnit;
      const height = room.height * pixelsPerWorldUnit;

      if (
        topLeft.x > viewportWidth ||
        topLeft.y > viewportHeight ||
        topLeft.x + width < 0 ||
        topLeft.y + height < 0
      ) {
        continue;
      }

      ctx.save();
      ctx.strokeStyle = colors.areaBorder;
      ctx.globalAlpha = 0.55;
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 10]);
      ctx.strokeRect(topLeft.x + 1, topLeft.y + 1, width - 2, height - 2);
      ctx.restore();
    }
  };

  /**
   * Signage: area names and what the gate is waiting for.
   *
   * Drawn after the light mask, unlike every other label, because it is the one thing in the hub a
   * player needs to read from across the room. The mask is a vignette around the player rather than
   * the server's lighting, so leaving these under it would fade out the sign pointing at the torches
   * exactly when a player is far enough away to need it.
   */
  const drawSigns = (scene: Scene, camera: Vector2): void => {
    ctx.textAlign = "center";

    // A fixture names its own area better than the area does, and the two labels landed within a
    // few pixels of each other in the one room that has both.
    const signposted = new Set(
      scene.dungeon.rooms
        .filter((room) =>
          scene.dungeon.exits.some(
            (exit) =>
              exit.position.x >= room.x &&
              exit.position.x < room.x + room.width &&
              exit.position.y >= room.y &&
              exit.position.y < room.y + room.height,
          ),
        )
        .map((room) => room.id),
    );

    if (scene.location === "hub") {
      ctx.fillStyle = colors.areaLabel;
      ctx.font = "13px sans-serif";
      for (const room of scene.dungeon.rooms) {
        if (signposted.has(room.id)) continue;
        const topLeft = worldToScreen({ x: room.x - 0.5, y: room.y - 0.5 }, camera);
        const width = room.width * pixelsPerWorldUnit;
        const height = room.height * pixelsPerWorldUnit;

        // Centred on the part of the area that is on screen, not on the area itself. An area here
        // is two hundred pixels wider than the viewport, so a name centred on its middle sits off
        // the edge for most of the walk across it: the first look at this drew a lone "Y" of
        // "QUEST GALLERY" against the left edge while the gallery filled half the screen.
        const left = Math.max(topLeft.x, 0);
        const right = Math.min(topLeft.x + width, viewportWidth);
        const top = Math.max(topLeft.y, 0);
        if (right - left < 80 || top > viewportHeight || topLeft.y + height < 0) continue;

        ctx.fillText(room.name.toUpperCase(), (left + right) / 2, top + 20);
      }
    }

    for (const exit of scene.dungeon.exits) {
      const center = worldToScreen(exit.position, camera);
      const caption = scene.location === "hub" ? "Dungeon Gate" : "Way Out";
      // Above the stairs rather than below them. Below is where a player stands to use them, and
      // the caption was drawn straight through their own name the moment they arrived.
      const captionY = center.y - (TILE_SCALE / 2) * pixelsPerWorldUnit - 8;

      ctx.fillStyle = colors.gateLabel;
      ctx.font = "14px sans-serif";
      ctx.fillText(caption, center.x, captionY);

      if (scene.location === "hub" && scene.gatePrompt) {
        ctx.fillStyle = colors.label;
        ctx.font = "12px sans-serif";
        ctx.fillText(scene.gatePrompt, center.x, captionY - 16);
      }
    }
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

    if (tileset.ready) {
      drawTileSprites(scene.dungeon, camera);
    } else {
      drawFlatTiles(scene.dungeon, camera);
    }

    if (scene.location === "hub") drawAreas(scene.dungeon.rooms, camera);

    // Stairs first: they are cut into the floor, so everything else stands on top of them.
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
    scene.dungeon.lightSources.forEach((light) => drawLightSource(light, camera));
    scene.dungeon.loot.filter((loot) => !loot.pickedUp).forEach((loot) => drawLoot(loot, camera));
    scene.dungeon.monsters
      .filter((monster) => monster.alive)
      .forEach((monster) => drawMonster(monster, camera));

    for (const player of scene.others) {
      const color = player.health > 0 ? colors.remotePlayer : colors.downedPlayer;
      drawFigure(player.position, carryLabel(player), color, !player.connected, camera);
    }

    if (scene.self) {
      const color = scene.self.health > 0 ? colors.localPlayer : colors.downedPlayer;
      drawFigure(scene.localPosition, carryLabel(scene.self), color, false, camera);
    }

    drawLightMask(camera);
    drawSigns(scene, camera);
  }

  window.addEventListener("resize", resize);
  resize();

  return { canvas, render, resize };
}
