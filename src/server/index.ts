import { PROTOCOL_VERSION, SERVER_TICK_RATE_HZ } from "../shared/constants/game.js";
import { createGameServer } from "./gameServer.js";
import { createFileProfileStorage, profileFilePath } from "./profiles/fileProfileStorage.js";
import { ProfileStore } from "./profiles/profileStore.js";
import { createFileRoomSaveStorage, roomSaveFilePath } from "./saves/fileRoomSaveStorage.js";
import { RoomSaveStore } from "./saves/roomSaveStore.js";
import { SessionStore } from "./sessions/sessionStore.js";
import { createFileVaultStorage, vaultFilePath } from "./vaults/fileVaultStorage.js";
import { VaultStore } from "./vaults/vaultStore.js";

const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? "0.0.0.0";

// The real deployment is the one place profiles, vaults and room saves touch a disk. Everywhere else - tests, and a bare
// `createGameServer()` - gets the in-memory default and writes nothing.
const profilesPath = profileFilePath();
const profiles = new ProfileStore({ storage: createFileProfileStorage(profilesPath) });
const vaultsPath = vaultFilePath();
const vaults = new VaultStore(createFileVaultStorage(vaultsPath));
const savesPath = roomSaveFilePath();
const saves = new RoomSaveStore(createFileRoomSaveStorage(savesPath));

const slowTickMs = process.env.SLOW_TICK_MS === undefined ? undefined : Number(process.env.SLOW_TICK_MS);

const server = createGameServer({
  profiles,
  store: new SessionStore({ vaults, saves }),
  ...(slowTickMs === undefined || !Number.isFinite(slowTickMs) ? {} : { slowTickMs }),
  ...(process.env.CORS_ORIGIN === undefined ? {} : { allowedOrigin: process.env.CORS_ORIGIN }),
});

await server.listen(port, host);
console.log(`[server] listening on http://${host}:${port}`);
console.log(`[server] protocol v${PROTOCOL_VERSION}, tick rate ${SERVER_TICK_RATE_HZ}Hz`);
console.log(`[server] ${profiles.size} profile(s) loaded from ${profilesPath}`);
console.log(`[server] ${vaults.size} party vault(s) loaded from ${vaultsPath}`);
console.log(`[server] ${saves.size} room save(s) loaded from ${savesPath}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log(`[server] ${signal} received, shutting down`);
    void server.close().then(() => process.exit(0));
  });
}
