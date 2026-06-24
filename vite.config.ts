import { defineConfig } from "vite";
import dyadComponentTagger from "@dyad-sh/react-vite-component-tagger";
import react from "@vitejs/plugin-react";
import path from "path";

import { nitro } from "nitro/vite";
import { viteSocketIO } from "./vite-socket-io";

export default defineConfig(() => ({
  server: {
    host: "::",
    port: 3000,
    allowedHosts: ["ch.alhawia.store"],
  },
  plugins: [dyadComponentTagger(), react(), nitro(), viteSocketIO()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
