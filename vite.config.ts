import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist/client",
    emptyOutDir: false,
  },
  server: {
    port: 5173,
  },
});
