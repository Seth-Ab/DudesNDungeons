import { PROTOCOL_VERSION, SERVER_TICK_RATE_HZ } from "../shared/constants/game.js";
import { createGameServer } from "./gameServer.js";
import { createFileProfileStorage, profileFilePath } from "./profiles/fileProfileStorage.js";
import { ProfileStore } from "./profiles/profileStore.js";

const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? "0.0.0.0";

// The real deployment is the one place profiles touch a disk. Everywhere else - tests, and a bare
// `createGameServer()` - gets the in-memory default and writes nothing.
const profilesPath = profileFilePath();
const profiles = new ProfileStore({ storage: createFileProfileStorage(profilesPath) });

const server = createGameServer({
  profiles,
  ...(process.env.CORS_ORIGIN === undefined ? {} : { allowedOrigin: process.env.CORS_ORIGIN }),
});

await server.listen(port, host);
console.log(`[server] listening on http://${host}:${port}`);
console.log(`[server] protocol v${PROTOCOL_VERSION}, tick rate ${SERVER_TICK_RATE_HZ}Hz`);
console.log(`[server] ${profiles.size} profile(s) loaded from ${profilesPath}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`[server] ${signal} received, shutting down`);
    void server.close().then(() => process.exit(0));
  });
}
