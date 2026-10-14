#!/usr/bin/env node
// A tiny stand-in for `opencode serve` (2.0.28) that answers the routes Folio
// calls and replays a recorded event stream. No dependencies.
//
// Usage: node scripts/replay-press.mjs [--port N] [--password PW] [--flaky]
//
// --flaky drops the first event stream right after its first frame, so a
// client has to reconnect. --pending starts with one ask and one form waiting
// on the fixture session, as if they were raised while no client listened.

import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "book", "__fixtures__");
const VERSION = "2.0.28";
const DIRECTORY = "/private/tmp/claude-501/-Users-me-folio/e9197d91-01d7-4355-b22f-541229eaf5c7/scratchpad/v2/repo";
const SESSION = "ses_ec87ce784ffeufwpMch0VZPNfx";
const PROMPT_ID = "msg_1378318cd0011en9zAGWcvx4bC";

function session(id, title, created, directory = DIRECTORY) {
  return {
    id,
    projectID: "76f404251248ff31bdc2b74cc6580a52fd06f20b",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created, updated: created },
    title,
    location: { directory },
  };
}

/**
 * Start the replay press. Resolves with its url, the requests it saw, and a
 * way to close it. `heartbeatMs` sets how often `: heartbeat` is sent.
 */
const GREET = "export function greet(name: string): string {\n  return `Hello, ${name}!`;\n}\n";

export async function startReplay({ port = 0, password = "replay", flaky = false, heartbeatMs = 10_000, pending = false, files = { "src/greet.ts": GREET } } = {}) {
  const editSse = readFileSync(join(fixtures, "fixture-edit.sse"), "utf8");
  const frames = editSse.split(/\n\n/).filter((frame) => frame.startsWith("data:"));
  const messages = JSON.parse(readFileSync(join(fixtures, "fixture-edit-messages.json"), "utf8")).data.slice().reverse();
  const diff = JSON.parse(readFileSync(join(fixtures, "fixture-edit-diff.json"), "utf8")).data;
  const sessions = [
    session(SESSION, "fixture edit", 1791932700841),
    session("ses_second", "Untitled", 1791932800000),
    session("ses_child", "a subagent", 1791932900000),
    session("ses_elsewhere", "another book", 1791932900001, "/elsewhere"),
  ];
  sessions[2].parentID = SESSION;
  // Pending requests, as `GET /api/session/{id}/permission` and `/form` list them.
  const asked = pending ? [{ ...eventData(readFileSync(join(fixtures, "fixture-ask.sse"), "utf8"), "permission.asked"), sessionID: SESSION }] : [];
  const forms = pending ? [{ ...eventData(readFileSync(join(fixtures, "aux-question.sse"), "utf8"), "form.created").form, sessionID: SESSION }] : [];
  const token = Buffer.from(`opencode:${password}`).toString("base64");
  const streams = new Set();
  const requests = [];
  let streamCount = 0;

  const send = (res, status, body) => {
    if (body === undefined) {
      res.writeHead(status);
      res.end();
      return;
    }
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://replay");
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString("utf8");
    let body;
    try {
      body = raw && req.headers["content-type"]?.includes("json") ? JSON.parse(raw) : raw || undefined;
    } catch {
      body = raw;
    }
    requests.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body });
    if (req.headers.authorization !== `Basic ${token}`) {
      return send(res, 401, { _tag: "UnauthorizedError", message: "Authentication required" });
    }
    const path = url.pathname;
    const method = req.method;
    let match;

    if (method === "GET" && path === "/api/info") {
      return send(res, 200, { version: VERSION, pid: process.pid, urls: [], paths: {}, capabilities: {} });
    }
    if (method === "GET" && path === "/api/event") {
      streamCount += 1;
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      res.write(`data: ${JSON.stringify({ id: `evt_hello${streamCount}`, type: "server.connected", data: {} })}\n\n`);
      if (flaky && streamCount === 1) {
        setTimeout(() => res.socket?.destroy(), 20);
        return;
      }
      const beat = setInterval(() => res.write(": heartbeat\n\n"), heartbeatMs);
      streams.add(res);
      res.on("close", () => {
        clearInterval(beat);
        streams.delete(res);
      });
      return;
    }
    if (method === "GET" && path === "/api/session") {
      // Two pages, the first with one session, to make a client follow the cursor.
      // As in 2.0.28, the cursor carries the first page's filters.
      const cursor = url.searchParams.get("cursor");
      const directory = cursor ? JSON.parse(Buffer.from(cursor, "base64url").toString()).directory : url.searchParams.get("directory");
      const list = sessions.filter((s) => !directory || s.location.directory === directory);
      const data = cursor ? list.slice(1) : list.slice(0, 1);
      const next = !cursor && list.length > 1 ? Buffer.from(JSON.stringify({ directory })).toString("base64url") : null;
      return send(res, 200, { data, cursor: { previous: null, next } });
    }
    if (method === "POST" && path === "/api/session") {
      const created = session(`ses_new${sessions.length}`, body?.title, Date.now(), body?.location?.directory ?? DIRECTORY);
      sessions.push(created);
      return send(res, 200, { data: created });
    }
    if (method === "GET" && path === "/api/session/active") return send(res, 200, { data: {} });
    if ((match = /^\/api\/session\/([^/]+)$/.exec(path)) && method === "PATCH") {
      // As in 2.0.28: the rules given replace the session's own; an empty list leaves the agent's defaults.
      const found = sessions.find((s) => s.id === match[1]);
      if (!found) return send(res, 404, { _tag: "SessionNotFoundError", sessionID: match[1], message: `Session not found: ${match[1]}` });
      if (typeof body?.title === "string") found.title = body.title;
      if (Array.isArray(body?.permissions)) found.permissions = body.permissions;
      return send(res, 204);
    }
    if ((match = /^\/api\/session\/([^/]+)\/message$/.exec(path)) && method === "GET") {
      // As in 2.0.28: the first page names the order, and a cursor carries it from then on.
      const cursor = url.searchParams.get("cursor");
      if (cursor && url.searchParams.has("order")) return send(res, 400, { _tag: "InvalidCursorError", message: "Cursor cannot be combined with order" });
      if (!cursor && url.searchParams.get("order") !== "asc") return send(res, 400, { _tag: "InvalidRequestError", message: "order" });
      const list = match[1] === SESSION ? messages : [];
      // Pages of two; the cursor is the next index.
      const from = Number(url.searchParams.get("cursor") ?? 0);
      const data = list.slice(from, from + 2);
      return send(res, 200, { data, cursor: { next: from + 2 < list.length ? String(from + 2) : null } });
    }
    if ((match = /^\/api\/session\/([^/]+)\/prompt$/.exec(path)) && method === "POST") {
      if (match[1] === "ses_busy") return send(res, 409, { _tag: "ConflictError", message: "The session is busy." });
      send(res, 200, {
        data: { id: PROMPT_ID, sessionID: match[1], time: { created: Date.now() }, type: "user", payload: { text: body?.text }, delivery: body?.delivery ?? "steer" },
      });
      setTimeout(() => {
        for (const stream of streams) for (const frame of frames.slice(1)) stream.write(`${frame}\n\n`);
      }, 10);
      return;
    }
    if ((match = /^\/api\/session\/([^/]+)\/diff$/.exec(path)) && method === "GET") {
      if (match[1] === "ses_broken") return send(res, 500, { _tag: "UnknownError", message: "The snapshot store is unreadable." });
      // As in 2.0.28: `from` must name a user message of the session.
      const from = url.searchParams.get("from");
      const users = match[1] === SESSION ? messages.filter((m) => m.type === "user").map((m) => m.id) : [];
      if (from && !users.includes(from)) return send(res, 400, { _tag: "InvalidRequestError", message: `Message ${from} is not a user message` });
      return send(res, 200, { data: match[1] === SESSION ? diff : [] });
    }
    if (/^\/api\/session\/[^/]+\/interrupt$/.test(path) && method === "POST") return send(res, 200, { interrupted: true });
    if ((match = /^\/api\/session\/([^/]+)\/(permission|form)$/.exec(path)) && method === "GET") {
      if (match[1] === "ses_broken") return send(res, 500, { _tag: "UnknownError", message: "The request store is unreadable." });
      const list = match[2] === "permission" ? asked : forms;
      return send(res, 200, { data: list.filter((item) => item.sessionID === match[1]) });
    }
    if ((match = /^\/api\/session\/[^/]+\/permission\/([^/]+)\/reply$/.exec(path)) && method === "POST") {
      drop(asked, match[1]);
      return send(res, 204);
    }
    if ((match = /^\/api\/session\/[^/]+\/form\/([^/]+)\/reply$/.exec(path)) && method === "POST") {
      drop(forms, match[1]);
      return send(res, 204);
    }
    if ((match = /^\/api\/session\/[^/]+\/form\/([^/]+)$/.exec(path)) && method === "DELETE") {
      drop(forms, match[1]);
      return send(res, 204);
    }
    if (/^\/api\/session\/[^/]+\/model$/.test(path) && method === "POST") return send(res, 204);
    if (/^\/api\/session\/[^/]+\/synthetic$/.test(path) && method === "POST") {
      return send(res, 200, { data: { id: "msg_synthetic", type: "synthetic", payload: { text: body?.text }, delivery: "steer" } });
    }
    if (method === "GET" && path === "/api/model/default") {
      return send(res, 200, { location: { directory: DIRECTORY }, data: { id: "cat-jam-free", modelID: "cat-jam-free", providerID: "opencode", name: "Cat Jam Free" } });
    }
    if (method === "GET" && path === "/api/model") {
      return send(res, 200, {
        location: { directory: DIRECTORY },
        data: [
          { id: "cat-jam-free", providerID: "opencode", name: "Cat Jam Free" },
          { id: "big-pickle", providerID: "opencode", name: "Big Pickle" },
        ],
      });
    }
    if (method === "GET" && path === "/api/provider") {
      return send(res, 200, { location: { directory: DIRECTORY }, data: [{ id: "opencode", integrationID: "opencode", name: "OpenCode", activation: "enabled" }] });
    }
    if (method === "GET" && path === "/api/integration") {
      return send(res, 200, {
        data: [
          { id: "anthropic", name: "Anthropic", methods: [{ type: "key" }, { type: "env", names: ["ANTHROPIC_API_KEY"] }], connections: [] },
          { id: "302ai", name: "302.AI", methods: [{ type: "key" }], connections: [] },
          { id: "github-copilot", name: "GitHub Copilot", methods: [{ type: "oauth", id: "device", label: "Sign in" }], connections: [] },
          { id: "togetherai", name: "Together AI", methods: [{ type: "key" }], connections: [] },
        ],
      });
    }
    if (/^\/api\/integration\/[^/]+\/connect\/key$/.test(path) && method === "POST") return send(res, 204);
    if (method === "GET" && path.startsWith("/api/fs/read/")) {
      // As in 2.0.28: a missing file is a 404 FileNotFoundError.
      const file = decodeURIComponent(path.slice("/api/fs/read/".length));
      if (!(file in files)) return send(res, 404, { _tag: "FileNotFoundError", path: file, message: `File not found: ${file}` });
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.end(files[file]);
      return;
    }
    // The experimental write route is left out on purpose: a client falls back to its host.
    return send(res, 404, { _tag: "NotFound", message: `No route for ${method} ${path}` });
  });

  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}`,
    requests,
    /** Number of event streams opened so far. */
    streams: () => streamCount,
    close: () =>
      new Promise((resolve) => {
        for (const stream of streams) stream.destroy();
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

/** The `data` of the first frame of `type` in a recorded stream. */
function eventData(sse, type) {
  for (const frame of sse.split(/\n\n/)) {
    if (!frame.startsWith("data:")) continue;
    const event = JSON.parse(frame.slice(5));
    if (event.type === type) return event.data;
  }
  throw new Error(`No ${type} frame in the fixture.`);
}

function drop(list, id) {
  const index = list.findIndex((item) => item.id === id);
  if (index >= 0) list.splice(index, 1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const value = (flag) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const replay = await startReplay({
    port: Number(value("--port") ?? 0),
    password: value("--password") ?? "replay",
    flaky: args.includes("--flaky"),
    pending: args.includes("--pending"),
  });
  // The same readiness line `opencode serve --stdio` prints.
  process.stdout.write(`${JSON.stringify({ url: replay.url })}\n`);
}
