import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // CPU-bound tests (dungeon generation sweeps) and socket waits both stretch on a busy machine,
    // such as several agents testing at once. A hang still fails, just later.
    testTimeout: 30_000,
  },
});
