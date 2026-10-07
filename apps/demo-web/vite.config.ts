import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, "");
  const proxyTarget = env.VITE_SECUREKIT_DEV_PROXY_TARGET?.trim() || "http://localhost:3001";

  return {
    plugins: [react()],
    envDir: __dirname,
    resolve: {
      alias: {
        "@securekit/web-sdk": path.resolve(__dirname, "../../packages/web-sdk/src/index.ts"),
      },
    },
    optimizeDeps: {
      exclude: ["@securekit/web-sdk"],
    },
    css: {
      postcss: {
        plugins: [],
      },
    },
    server: {
      proxy: {
        "/api/securekit": {
          target: proxyTarget,
          changeOrigin: true,
          secure: false,
          rewrite: (requestPath) => {
            if (requestPath.startsWith("/api/securekit/keystroke/")) {
              return requestPath;
            }
            return requestPath.replace(/^\/api\/securekit/, "");
          },
        },
      },
    },
    build: {
      rollupOptions: {
        input: {
          index: path.resolve(__dirname, "index.html"),
          auth: path.resolve(__dirname, "auth.html"),
        },
      },
    },
  };
});
