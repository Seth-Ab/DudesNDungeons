import { defineConfig, devices } from "@playwright/test";

const PORT = 5173;
const SERVER_PORT = 8080;

export default defineConfig({
  testDir: "tests/e2e/browser",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
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
