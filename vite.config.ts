import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist/client",
    emptyOutDir: false,
  },
  server: {
    // Overridable so parallel worktrees can each run the browser suite on their own ports.
    port: Number(process.env.CLIENT_PORT ?? 5173),
  },
});
