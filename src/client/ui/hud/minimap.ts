import { tileOf } from "../../../shared/game/movement.js";
import type { Vector2 } from "../../../shared/types/core.js";
import type { SessionView } from "../../network/sessionState.js";
import {
  MINIMAP_SIZE,
  minimapAllies,
  minimapIcons,
  minimapPoint,
  minimapRoomHeader,
  minimapRoomKindAt,
  MINIMAP_KIND_TINTS,
  minimapTile,
  minimapViewport,
  minimapWorldKey,
  NO_MARKERS,
  rememberMarkers,
  syncMinimapVisibility,
  type MinimapAlly,
  type MinimapIconKind,
  type MinimapViewport,
  type RememberedMarkers,
} from "../../state/minimap.js";
import { selfOf } from "../../network/sessionState.js";

const WALL_COLOR = "#6b6259";
const FLOOR_COLOR = "#2a2723";
const SELF_COLOR = "#ffe08a";
const EXIT_COLOR = "#8fe3a0";
const CHEST_COLOR = "#d8a64a";
const CHEST_OPENED_COLOR = "#8a7550";
const OUTLINE_COLOR = "#0b0b0c";
const INITIAL_FONT = "bold 8px ui-sans-serif, system-ui, sans-serif";

/** Hover text for the panel, standing in for a legend. */
const MINIMAP_LEGEND =
  "Minimap. Arrow: you. Ring with a letter: an ally, a cross when downed. Arch: exit. Box: chest, hollow once opened.";

type Context = CanvasRenderingContext2D;

function fillTiles(context: Context, view: SessionView, viewport: MinimapViewport): void {
  const map = view.dungeon?.map;
  if (!map) return;

  const first = (edge: number): number => Math.max(0, Math.floor(edge));
  const x0 = first(viewport.left);
  const y0 = first(viewport.top);
  const x1 = Math.min(map.width, Math.ceil(viewport.left + viewport.tilesAcross));
  const y1 = Math.min(map.height, Math.ceil(viewport.top + viewport.tilesAcross));
  const rooms = view.dungeon?.rooms ?? [];
  const tileKey = (x: number, y: number): string => {
    const kind = minimapTile(map, x, y);
    if (kind !== "floor") return kind;
    const room = minimapRoomKindAt(rooms, x, y);
    return room && MINIMAP_KIND_TINTS[room] ? `floor:${room}` : "floor";
  };

  for (let y = y0; y < y1; y++) {
    // One rectangle per run of like tiles keeps a large explored map cheap to draw.
    let runStart = x0;
    let runKind = tileKey(x0, y);
    for (let x = x0 + 1; x <= x1; x++) {
      const kind = x < x1 ? tileKey(x, y) : null;
      if (kind === runKind) continue;
      if (runKind !== "unknown") {
        const tint = runKind.startsWith("floor:") ? MINIMAP_KIND_TINTS[runKind.slice(6) as keyof typeof MINIMAP_KIND_TINTS] : undefined;
        context.fillStyle = runKind === "wall" ? WALL_COLOR : (tint ?? FLOOR_COLOR);
        const from = minimapPoint(viewport, runStart, y);
        const to = minimapPoint(viewport, x, y + 1);
        // Rounded outwards so neighbouring runs meet without hairline gaps.
        const left = Math.floor(from.x);
        const top = Math.floor(from.y);
        context.fillRect(left, top, Math.ceil(to.x) - left, Math.ceil(to.y) - top);
      }
      runStart = x;
      runKind = kind ?? runKind;
    }
  }
}

function centreOf(viewport: MinimapViewport, tile: Vector2): { x: number; y: number } {
  const corner = minimapPoint(viewport, tile.x, tile.y);
  return { x: corner.x + viewport.scale / 2, y: corner.y + viewport.scale / 2 };
}

function inPanel(point: { x: number; y: number }): boolean {
  return point.x >= 0 && point.y >= 0 && point.x <= MINIMAP_SIZE && point.y <= MINIMAP_SIZE;
}

function drawInitial(context: Context, at: { x: number; y: number }, initial: string, color: string): void {
  context.font = INITIAL_FONT;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.lineWidth = 2;
  context.strokeStyle = OUTLINE_COLOR;
  context.strokeText(initial, at.x, at.y + 0.5);
  context.fillStyle = color;
  context.fillText(initial, at.x, at.y + 0.5);
}

/**
 * A ring holding the ally's initial while they stand, a cross with the initial beside it once they
 * are down, both in their party colour: shape carries the state and the letter the identity, so
 * neither rests on colour alone.
 */
function drawAlly(context: Context, at: { x: number; y: number }, ally: MinimapAlly): void {
  if (ally.shape === "downed") {
    const arm = 4;
    context.beginPath();
    context.moveTo(at.x - arm, at.y - arm);
    context.lineTo(at.x + arm, at.y + arm);
    context.moveTo(at.x + arm, at.y - arm);
    context.lineTo(at.x - arm, at.y + arm);
    context.lineWidth = 4;
    context.strokeStyle = OUTLINE_COLOR;
    context.stroke();
    context.lineWidth = 2;
    context.strokeStyle = ally.color;
    context.stroke();
    drawInitial(context, { x: at.x + arm + 4, y: at.y - arm - 2 }, ally.initial, ally.color);
    return;
  }

  context.beginPath();
  context.arc(at.x, at.y, 6, 0, Math.PI * 2);
  context.fillStyle = OUTLINE_COLOR;
  context.fill();
  context.lineWidth = 2;
  context.strokeStyle = ally.color;
  context.stroke();
  drawInitial(context, at, ally.initial, ally.color);
}

/** A doorway: an arch with a dark opening. */
function drawExit(context: Context, at: { x: number; y: number }): void {
  const half = 4;
  const outline = (inset: number): void => {
    context.beginPath();
    context.moveTo(at.x - half + inset, at.y + half);
    context.lineTo(at.x - half + inset, at.y - 1);
    context.arc(at.x, at.y - 1, half - inset, Math.PI, 0);
    context.lineTo(at.x + half - inset, at.y + half);
    context.closePath();
  };
  outline(0);
  context.fillStyle = EXIT_COLOR;
  context.strokeStyle = OUTLINE_COLOR;
  context.lineWidth = 1;
  context.fill();
  context.stroke();
  outline(2);
  context.fillStyle = OUTLINE_COLOR;
  context.fill();
}

/** A box with a lid line; an opened chest is drawn as an empty outline. */
function drawChest(context: Context, at: { x: number; y: number }, opened: boolean): void {
  const left = Math.round(at.x) - 4.5;
  const top = Math.round(at.y) - 3.5;
  if (opened) {
    context.strokeStyle = OUTLINE_COLOR;
    context.lineWidth = 3;
    context.strokeRect(left, top, 9, 7);
    context.strokeStyle = CHEST_OPENED_COLOR;
    context.lineWidth = 1;
    context.strokeRect(left, top, 9, 7);
    return;
  }
  context.fillStyle = CHEST_COLOR;
  context.fillRect(left, top, 9, 7);
  context.strokeStyle = OUTLINE_COLOR;
  context.lineWidth = 1;
  context.strokeRect(left, top, 9, 7);
  context.beginPath();
  context.moveTo(left, top + 3);
  context.lineTo(left + 9, top + 3);
  context.stroke();
}

function drawIcon(context: Context, at: { x: number; y: number }, kind: MinimapIconKind): void {
  if (kind === "exit") drawExit(context, at);
  else drawChest(context, at, kind === "openedChest");
}

/** A filled arrowhead pointing along the player's facing. */
function drawSelf(context: Context, at: { x: number; y: number }, facing: Vector2): void {
  const length = Math.hypot(facing.x, facing.y) || 1;
  const dx = facing.x / length;
  const dy = facing.y === 0 && facing.x === 0 ? 1 : facing.y / length;
  const size = 6;
  const tip = { x: at.x + dx * size, y: at.y + dy * size };
  const back = { x: at.x - dx * size * 0.6, y: at.y - dy * size * 0.6 };
  const wing = size * 0.65;

  context.fillStyle = SELF_COLOR;
  context.strokeStyle = OUTLINE_COLOR;
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(tip.x, tip.y);
  context.lineTo(back.x - dy * wing, back.y + dx * wing);
  context.lineTo(back.x + dy * wing, back.y - dx * wing);
  context.closePath();
  context.fill();
  context.stroke();
}

/**
 * A corner overview drawn from the client's accumulated discovered map: black except where the
 * server has sent geometry. A header strip names the room the player is in and marks north. It repaints only when the map object, the player's tile or facing, the
 * visible allies, or the remembered exits and chests change, since none of those move every frame.
 */
export function createMinimap() {
  const element = document.createElement("div");
  element.className = "hud__minimap";
  element.hidden = true;

  const header = document.createElement("div");
  header.className = "hud__minimap-header";
  const roomName = document.createElement("span");
  roomName.className = "hud__minimap-room";
  const north = document.createElement("span");
  north.className = "hud__minimap-north";
  north.textContent = "N";
  north.title = "North is up";
  north.setAttribute("aria-label", "North is up");
  header.append(roomName, north);

  const canvas = document.createElement("canvas");
  canvas.className = "hud__minimap-canvas";
  canvas.width = MINIMAP_SIZE;
  canvas.height = MINIMAP_SIZE;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "Minimap of the explored dungeon");
  canvas.title = MINIMAP_LEGEND;
  element.append(header, canvas);

  const context = canvas.getContext("2d");

  let visibility = { worldKey: null as string | null, visible: true };
  let markers: RememberedMarkers = NO_MARKERS;
  let drawn = "";
  let lastMap: unknown = null;
  let lastView: SessionView | null = null;
  let position: Vector2 | null = null;

  const redraw = (): void => {
    const view = lastView;
    const self = view ? selfOf(view) : null;
    const map = view?.dungeon?.map;
    const show = visibility.visible && !!view && !!map && !!self && position !== null;
    element.hidden = !show;
    if (!show || !context || !view || !map || !self || !position) return;

    const name = minimapRoomHeader(view, position);
    if (roomName.textContent !== name) roomName.textContent = name;

    const tile = tileOf(position);
    const allies = minimapAllies(view);
    const icons = minimapIcons(map, markers);
    const signature = [
      name,
      view.dungeon?.rooms.length ?? 0,
      tile.x,
      tile.y,
      self.facing.x,
      self.facing.y,
      allies
        .map((ally) => `${ally.id}@${ally.tile.x},${ally.tile.y}${ally.shape}${ally.color}${ally.initial}`)
        .join(";"),
      icons.map((icon) => `${icon.id}@${icon.tile.x},${icon.tile.y}${icon.kind}`).join(";"),
    ].join("|");
    if (map === lastMap && signature === drawn) return;
    lastMap = map;
    drawn = signature;

    const viewport = minimapViewport(map.width, map.height, tile);
    context.clearRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
    context.fillStyle = "#000";
    context.fillRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
    fillTiles(context, view, viewport);

    for (const icon of icons) {
      const point = centreOf(viewport, icon.tile);
      if (inPanel(point)) drawIcon(context, point, icon.kind);
    }
    for (const ally of allies) {
      const point = centreOf(viewport, ally.tile);
      if (inPanel(point)) drawAlly(context, point, ally);
    }
    drawSelf(context, centreOf(viewport, tile), self.facing);
  };

  return {
    element,

    /** Flips the panel; returns whether it is now shown. */
    toggle(): boolean {
      visibility = { ...visibility, visible: !visibility.visible };
      drawn = "";
      redraw();
      return visibility.visible;
    },

    update(view: SessionView): void {
      const worldKey = minimapWorldKey(view);
      visibility = syncMinimapVisibility(visibility, worldKey);
      markers = rememberMarkers(markers, worldKey, {
        exits: view.dungeon?.exits ?? [],
        chests: view.dungeon?.chests ?? [],
      });
      lastView = view;
      if (worldKey === null) position = null;
      else position ??= selfOf(view)?.position ?? null;
      redraw();
    },

    /** The predicted position, which moves between snapshots. */
    setPosition(next: Vector2): void {
      position = next;
      redraw();
    },
  };
}
