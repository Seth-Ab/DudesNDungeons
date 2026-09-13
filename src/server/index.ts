import { PROTOCOL_VERSION, SERVER_TICK_RATE_HZ } from "../shared/constants/game.js";
import { createGameServer } from "./gameServer.js";

const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? "0.0.0.0";

const server = createGameServer({
  ...(process.env.CORS_ORIGIN === undefined ? {} : { allowedOrigin: process.env.CORS_ORIGIN }),
});

await server.listen(port, host);
console.log(`[server] listening on http://${host}:${port}`);
console.log(`[server] protocol v${PROTOCOL_VERSION}, tick rate ${SERVER_TICK_RATE_HZ}Hz`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`[server] ${signal} received, shutting down`);
    void server.close().then(() => process.exit(0));
  });
}
