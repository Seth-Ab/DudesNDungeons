import { createServer } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { PROTOCOL_VERSION, SERVER_TICK_RATE_HZ } from "../shared/constants/game.js";
import {
  parseClientMessage,
  serializeServerMessage,
  type ErrorCode,
} from "../shared/protocol/index.js";

const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? "0.0.0.0";

function sendError(socket: WebSocket, code: ErrorCode, message: string): void {
  socket.send(serializeServerMessage({ type: "sessionError", code, message }));
}

const httpServer = createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "ok", protocolVersion: PROTOCOL_VERSION }));
    return;
  }

  response.writeHead(404);
  response.end();
});

const wss = new WebSocketServer({ server: httpServer });

wss.on("connection", (socket) => {
  console.log("[ws] client connected");

  socket.on("message", (data) => {
    const result = parseClientMessage(data.toString());

    if (!result.ok) {
      console.warn("[ws] rejected message:", result.error);
      sendError(socket, "invalidMessage", result.error);
      return;
    }

    console.log(`[ws] received ${result.message.type}`);
    sendError(
      socket,
      "notImplemented",
      `"${result.message.type}" is accepted by the protocol but not handled yet`,
    );
  });

  socket.on("close", () => {
    console.log("[ws] client disconnected");
  });

  socket.on("error", (error) => {
    console.error("[ws] socket error:", error);
  });
});

httpServer.listen(port, host, () => {
  console.log(`[server] listening on http://${host}:${port}`);
  console.log(`[server] protocol v${PROTOCOL_VERSION}, tick rate ${SERVER_TICK_RATE_HZ}Hz`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`[server] ${signal} received, shutting down`);
    wss.close();
    httpServer.close(() => process.exit(0));
  });
}
