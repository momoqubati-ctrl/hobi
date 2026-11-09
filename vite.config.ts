import { defineConfig, loadEnv } from "vite";
import dyadComponentTagger from "@dyad-sh/react-vite-component-tagger";
import react from "@vitejs/plugin-react";
import path from "path";
import basicSsl from "@vitejs/plugin-basic-ssl";

import { nitro } from "nitro/vite";
import { viteSocketIO } from "./vite-socket-io";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const minioEndpoint = env.MINIO_ENDPOINT || "127.0.0.1";
  const minioPort = Number(env.MINIO_PORT) || 9000;
  const minioBucket = env.MINIO_BUCKET || "serene-panda";
  const minioProtocol = env.MINIO_USE_SSL === "true" ? "https" : "http";

  return {
    server: {
      host: "::",
      port: Number(process.env.PORT) || 3000,
      strictPort: true,
      allowedHosts: ["ch.alhawia.store"],
      watch: {
        ignored: ["**/.output/**", "**/minio-data/**", "**/scratch/**"],
      },
      proxy: {
        "/minio": {
          target: `${minioProtocol}://${minioEndpoint}:${minioPort}`,
          changeOrigin: true,
          rewrite: (requestPath) => {
            const segments = requestPath.replace(/^\/minio\/?/, "").split("/").filter(Boolean);
            if (segments[0] === minioBucket) segments.shift();
            return `/${minioBucket}/${segments.join("/")}`;
          },
        },
      },
    },
    plugins: [dyadComponentTagger(), react(), basicSsl(), viteSocketIO(), nitro()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    build: {
      // تقسيم الـ bundle لتقليل Initial Load
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("node_modules/react") || id.includes("node_modules/react-dom") || id.includes("node_modules/react-router-dom")) return "react-vendor";
            if (id.includes("node_modules/@tanstack/react-query")) return "query-vendor";
            if (id.includes("node_modules/lucide-react")) return "ui-vendor";
          },
        },
      },
      // تحذير عند تجاوز 800KB لأي chunk
      chunkSizeWarningLimit: 800,
      // esbuild أسرع بكثير من terser في الـ minification
      minify: "esbuild",
    },
  };
});
// Reload config: PM media update
