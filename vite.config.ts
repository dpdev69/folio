import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { installPress, probePress, servePress } from "./press/host";

// The browser dev server talks to opencode through this same-origin proxy,
// so the page does not need CORS. Tauri uses the Rust proxy instead.
// /folio/* is the local press helper: detect, install, and start opencode.
export default defineConfig({
  plugins: [react(), pressPlugin()],
  server: {
    host: "127.0.0.1",
    port: 47321,
    strictPort: true,
    proxy: {
      "/engine": {
        target: "http://127.0.0.1:4096",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/engine/, ""),
      },
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 47321,
    strictPort: true,
  },
  clearScreen: false,
});

function pressPlugin(): Plugin {
  return {
    name: "folio-press",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split("?")[0];
        if (!url?.startsWith("/folio/")) return next();
        try {
          const body =
            url === "/folio/press"
              ? await probePress()
              : url === "/folio/serve" && req.method === "POST"
                ? await servePress()
                : url === "/folio/install" && req.method === "POST"
                  ? await installPress()
                  : null;
          if (!body) return next();
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify(body));
        } catch (error) {
          res.statusCode = 500;
          res.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : "press helper failed" }));
        }
      });
    },
  };
}
