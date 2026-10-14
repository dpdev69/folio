import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { installPress, probePress, readBookFile, removeBookFile, servePress, stopPress, writeBookFile } from "./press/host";

// The page calls the opencode server directly with Basic auth (CORS allows
// http://127.0.0.1:*). /folio/* is the local press helper: detect, install and
// start opencode, and read or write files in the open book.
export default defineConfig({
  plugins: [react(), pressPlugin()],
  server: {
    host: "127.0.0.1",
    port: 47321,
    strictPort: true,
  },
  preview: {
    host: "127.0.0.1",
    port: 47321,
    strictPort: true,
  },
  clearScreen: false,
});

const ORIGINS = new Set(["http://127.0.0.1:47321", "http://localhost:47321"]);

// One exit hook for the whole process, however many times the dev server restarts.
let exitHooked = false;

function pressPlugin(): Plugin {
  return {
    name: "folio-press",
    configureServer(server) {
      server.httpServer?.once("close", () => void stopPress());
      if (!exitHooked) {
        exitHooked = true;
        // An exit handler cannot wait, so this one kills without the grace period.
        process.once("exit", () => void stopPress(0));
      }
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? "/", "http://folio");
        if (!url.pathname.startsWith("/folio/")) return next();
        // Only Folio's own page may start the press or touch files.
        const origin = req.headers.origin;
        const site = req.headers["sec-fetch-site"];
        if ((origin && !ORIGINS.has(origin)) || site === "cross-site") return reply(res, 403, { ok: false, error: "Not for this page." });
        try {
          const route = `${req.method} ${url.pathname}`;
          if (route === "GET /folio/press") return reply(res, 200, await probePress());
          if (route === "POST /folio/serve") return reply(res, 200, await servePress());
          if (route === "POST /folio/install") return reply(res, 200, await installPress());
          if (route === "POST /folio/write") {
            const body = (await readJson(req)) as { directory?: unknown; path?: unknown; content?: unknown };
            if (typeof body.directory !== "string" || typeof body.path !== "string" || typeof body.content !== "string") {
              return reply(res, 400, { ok: false, error: "A write needs a directory, a path and content." });
            }
            return reply(res, 200, await writeBookFile(body.directory, body.path, body.content));
          }
          if (route === "POST /folio/remove") {
            const body = (await readJson(req)) as { directory?: unknown; path?: unknown };
            if (typeof body.directory !== "string" || typeof body.path !== "string") {
              return reply(res, 400, { ok: false, error: "A removal needs a directory and a path." });
            }
            return reply(res, 200, await removeBookFile(body.directory, body.path));
          }
          if (route === "GET /folio/read") {
            const directory = url.searchParams.get("directory") ?? "";
            const file = url.searchParams.get("path") ?? "";
            return reply(res, 200, await readBookFile(directory, file));
          }
          return next();
        } catch (error) {
          return reply(res, 500, { ok: false, error: error instanceof Error ? error.message : "The press helper failed." });
        }
      });
    },
  };
}

function reply(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  if (!req.headers["content-type"]?.includes("application/json")) return {};
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}
