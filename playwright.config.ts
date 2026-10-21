import { defineConfig, devices } from "@playwright/test";

const PORT = 5173;
const SERVER_PORT = 8080;

export default defineConfig({
  testDir: "tests/e2e/browser",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // The walking specs take 20-30 s on a two-core CI runner, so the 30 s default timed out their
  // first attempt in most runs and only the retry passed. Locally they finish in about 10 s.
  timeout: process.env.CI ? 60_000 : 30_000,
  // Most specs drive two browsers against one server and spend their time waiting. One worker per
  // two-core CI runner is all it holds: with two, the game server is starved and the timing-
  // sensitive specs time out, so CI gets its parallelism from shards. Locally, more than a few
  // workers does the same.
  workers: process.env.CI ? 1 : 3,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
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
      url: `http://127.0.0.1:${PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      // Specs that create or join a room need a live server. Reusing a running dev:server is fine.
      command: "npm run dev:server",
      url: `http://127.0.0.1:${SERVER_PORT}/health`,
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
