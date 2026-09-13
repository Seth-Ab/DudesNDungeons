import type { MoveDirection } from "../state/gameState";

export type ConnectionStatus = "offline" | "connecting" | "connected" | "disconnected";

type GameClientOptions = {
  url: string;
};

export function createGameClient(options: GameClientOptions) {
  let socket: WebSocket | undefined;
  let statusHandler: (status: ConnectionStatus) => void = () => {};

  const setStatus = (status: ConnectionStatus) => {
    statusHandler(status);
  };

  return {
    connect() {
      if (socket && socket.readyState !== WebSocket.CLOSED) {
        return;
      }

      setStatus("connecting");
      socket = new WebSocket(options.url);

      socket.addEventListener("open", () => setStatus("connected"));
      socket.addEventListener("close", () => setStatus("disconnected"));
      socket.addEventListener("error", () => setStatus("disconnected"));
    },
    onStatusChange(handler: (status: ConnectionStatus) => void) {
      statusHandler = handler;
      setStatus(socket ? "connecting" : "offline");
    },
    sendMoveIntent(direction: MoveDirection) {
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        return;
      }

      socket.send(
        JSON.stringify({
          type: "playerMove",
          direction,
        }),
      );
    },
  };
}
