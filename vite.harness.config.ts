import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  root: ".",
  server: {
    host: "127.0.0.1",
    port: 3333,
    strictPort: true,
    open: false,
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@/lib/socket": path.resolve(__dirname, "./tests/harness/mockSocket.ts"),
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "dist-harness",
    rollupOptions: {
      input: {
        harness: path.resolve(__dirname, "tests/harness/index.html"),
      },
    },
  },
});
