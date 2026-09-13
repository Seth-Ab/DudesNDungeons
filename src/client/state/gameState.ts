export type MoveDirection = "north" | "south" | "east" | "west";

export type Position = {
  x: number;
  y: number;
};

export type PlayerState = {
  id: string;
  name: string;
  position: Position;
  hp: number;
};

export type DungeonState = {
  tiles: string[];
  monsters: Position[];
};

export type GameState = {
  dungeon: DungeonState;
  localPlayer: PlayerState;
  remotePlayers: PlayerState[];
};

export function createInitialGameState(): GameState {
  return {
    dungeon: {
      tiles: [
        "################",
        "#..............#",
        "#..####........#",
        "#.......##.....#",
        "#..............#",
        "#.....###......#",
        "#..............#",
        "################",
      ],
      monsters: [
        { x: 11, y: 2 },
        { x: 5, y: 5 },
      ],
    },
    localPlayer: {
      id: "local-preview",
      name: "You",
      position: { x: 2, y: 2 },
      hp: 20,
    },
    remotePlayers: [
      {
        id: "preview-ally",
        name: "Ally",
        position: { x: 4, y: 4 },
        hp: 20,
      },
    ],
  };
}

export function moveLocalPlayer(gameState: GameState, direction: MoveDirection) {
  const nextPosition = getNextPosition(gameState.localPlayer.position, direction);

  if (!isWalkable(gameState.dungeon, nextPosition)) {
    return;
  }

  gameState.localPlayer.position = nextPosition;
}

function getNextPosition(position: Position, direction: MoveDirection): Position {
  switch (direction) {
    case "north":
      return { x: position.x, y: position.y - 1 };
    case "south":
      return { x: position.x, y: position.y + 1 };
    case "east":
      return { x: position.x + 1, y: position.y };
    case "west":
      return { x: position.x - 1, y: position.y };
  }
}

function isWalkable(dungeon: DungeonState, position: Position) {
  const row = dungeon.tiles[position.y];

  if (!row) {
    return false;
  }

  return row[position.x] === ".";
}
