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
      port: 3000,
      strictPort: true,
      allowedHosts: ["ch.alhawia.store"],
      watch: {
        ignored: ["**/.output/**", "**/minio-data/**"],
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
  };
});
