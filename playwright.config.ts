import { defineConfig, devices } from "@playwright/test";
import { CLIENT_PORT, SERVER_PORT } from "./tests/e2e/browser/ports.js";

export default defineConfig({
  testDir: "tests/e2e/browser",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Most specs drive two browsers against one server and spend their time waiting. One worker per
  // two-core CI runner is all it holds: with two, the game server is starved and the timing-
  // sensitive specs time out, so CI gets its parallelism from shards. Locally, more than a few
  // workers does the same.
  workers: process.env.CI ? 1 : 3,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${CLIENT_PORT}`,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "npm run dev:client",
      // The client is built against the server this run starts, not whatever VITE_WS_URL says.
      env: { CLIENT_PORT: String(CLIENT_PORT), VITE_WS_URL: `ws://localhost:${SERVER_PORT}` },
      url: `http://127.0.0.1:${CLIENT_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      // Specs that create or join a room need a live server. Reusing a running dev:server is fine.
      command: "npm run dev:server",
      env: { PORT: String(SERVER_PORT) },
      url: `http://127.0.0.1:${SERVER_PORT}/health`,
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
