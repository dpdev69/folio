import { afterEach, describe, expect, it, vi } from "vitest";
import { REPLAY_DIRECTORY, startReplay, type Replay } from "../../scripts/replay-press.mjs";
import { applyEvent } from "../book/events";
import type { Book } from "../book/model";
import { chapterFromMessages } from "../book/transcript";
import { EngineClient, EngineError } from "./client";
import { backoffDelay, watchdog, type EventFrame } from "./sse";

const DIRECTORY = REPLAY_DIRECTORY;
const SESSION = "ses_ec87ce784ffeufwpMch0VZPNfx";

let replay: Replay | undefined;
const aborts: AbortController[] = [];

afterEach(async () => {
  for (const ctrl of aborts.splice(0)) ctrl.abort();
  await replay?.close();
  replay = undefined;
});

async function press(options: Parameters<typeof startReplay>[0] = {}) {
  replay = await startReplay({ password: "pw", ...options });
  return replay;
}

async function until(check: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function listen(client: EngineClient) {
  const frames: EventFrame[] = [];
  const ctrl = new AbortController();
  aborts.push(ctrl);
  client.subscribe((frame) => frames.push(frame), ctrl.signal);
  return frames;
}

describe("EngineClient against the replay press", () => {
  it("needs the password, and says so calmly", async () => {
    const { url, requests } = await press();
    const error = await new EngineClient(url, { password: "wrong" }).info().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(EngineError);
    expect(error).toMatchObject({ status: 401, tag: "UnauthorizedError", message: "The press wants a different password." });
    const info = await new EngineClient(url, { password: "pw" }).info();
    expect(info.version).toBe("2.0.28");
    expect(requests.at(-1)?.path).toBe("/api/info");
  });

  it("unwraps {data} and follows the session cursor, keeping only root sessions", async () => {
    const { url, requests } = await press();
    const client = new EngineClient(url, { password: "pw" });
    const sessions = await client.sessions(DIRECTORY);
    expect(sessions.map((s) => s.id)).toEqual([SESSION, "ses_second"]);
    const listed = requests.filter((r) => r.path === "/api/session");
    expect(listed.length).toBe(2);
    expect(listed[0].query.directory).toBe(DIRECTORY);
    expect(listed[1].query).toEqual({ cursor: expect.any(String), limit: "100" });
    const model = await client.defaultModel();
    expect(model).toMatchObject({ id: "cat-jam-free", providerID: "opencode" });
    expect((await client.providers()).map((p) => p.name)).toEqual(["OpenCode"]);
  });

  it("reads history oldest first across pages, ready for chapterFromMessages", async () => {
    const { url, requests } = await press();
    const client = new EngineClient(url, { password: "pw" });
    const messages = await client.messages(SESSION);
    expect(messages.map((m) => (m as { type: string }).type)).toEqual(["user", "assistant", "assistant", "assistant", "idle"]);
    expect(requests.filter((r) => r.path.endsWith("/message")).length).toBe(3);
    const chapter = chapterFromMessages(
      { id: SESSION, title: "t", untitled: false, blocks: [], footnotes: [], plates: [], notes: [], asks: [], forms: [], busy: false },
      messages,
    );
    expect(chapter.blocks.some((b) => b.text.includes("farewell"))).toBe(true);
  });

  it("creates a session bound to a folder, with ask rules", async () => {
    const { url, requests } = await press();
    const client = new EngineClient(url, { password: "pw" });
    const rules = [{ action: "edit", resource: "*", effect: "ask" as const }];
    const created = await client.createSession({ title: "Untitled", directory: "/book", permissions: rules });
    expect(created.id).toMatch(/^ses_new/);
    expect(requests.at(-1)?.body).toEqual({ title: "Untitled", location: { directory: "/book" }, permissions: rules });
  });

  it("returns the user message id from a prompt and streams the turn unfiltered", async () => {
    const { url, requests } = await press();
    const client = new EngineClient(url, { password: "pw" });
    const frames = listen(client);
    await until(() => frames.some((f) => f.type === "server.connected"));
    const id = await client.prompt(SESSION, "Add a farewell", "queue");
    expect(id).toBe("msg_1378318cd0011en9zAGWcvx4bC");
    expect(requests.at(-1)?.body).toEqual({ text: "Add a farewell", delivery: "queue" });
    await until(() => frames.some((f) => f.type === "session.execution.succeeded"));
    expect(frames.some((f) => f.type === "session.tool.input.started")).toBe(true);
    // Frames reach the reducer as {type, data, location?}, nothing more.
    for (const frame of frames) expect(Object.keys(frame).every((k) => ["type", "data", "location"].includes(k))).toBe(true);
    // The recorded stream names the folder it was recorded in; the book is opened there.
    const recorded = frames.find((f) => f.type === "session.created")?.location?.directory;
    const directory = typeof recorded === "string" ? recorded : DIRECTORY;
    const empty: Book = { id: directory, title: "repo", directory, sample: false, chapters: [] };
    const book = frames.reduce(applyEvent, empty);
    const chapter = book.chapters[0];
    expect(chapter.blocks.some((b) => b.text.startsWith("Added a `farewell(name)`"))).toBe(true);
    expect(chapter.footnotes.length).toBeGreaterThan(0);
    expect(chapter.busy).toBe(false);
  });

  it("reconnects after the stream drops, pausing once and resuming", async () => {
    const { url } = await press({ flaky: true });
    const client = new EngineClient(url, { password: "pw", stream: { retryDelay: () => 10, steadyMs: 50 } });
    const frames = listen(client);
    await until(() => frames.some((f) => f.type === "folio.stream-resumed"));
    // The return is announced once the new connection has held, not the moment it opens.
    expect(frames.map((f) => f.type)).toEqual([
      "server.connected",
      "folio.stream-paused",
      "server.connected",
      "folio.stream-resumed",
    ]);
    expect(frames[1].data?.message).toBeTruthy();
  });

  it("says the stream is failing after every third reconnect that fails", async () => {
    const live = await press();
    const client = new EngineClient(live.url, { password: "pw", stream: { retryDelay: () => 5 } });
    const frames = listen(client);
    await until(() => frames.some((f) => f.type === "server.connected"));
    await live.close();
    await until(() => frames.filter((f) => f.type === "folio.stream-failing").length >= 2);
    const failing = frames.filter((f) => f.type === "folio.stream-failing");
    expect(failing.slice(0, 2).map((f) => f.data?.attempts)).toEqual([3, 6]);
    expect(frames.filter((f) => f.type === "folio.stream-paused").length).toBe(1);
    // The first failing frame comes after the pause and three failed reconnects.
    expect(frames.findIndex((f) => f.type === "folio.stream-paused")).toBeLessThan(frames.indexOf(failing[0]));
  });

  it("keeps backing off when every connection opens and drops at once, without announcing a return", async () => {
    vi.useFakeTimers();
    let opened = 0;
    const encoder = new TextEncoder();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        opened += 1;
        const body = new ReadableStream<Uint8Array>({
          start(ctrl) {
            ctrl.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "server.connected", data: {} })}\n\n`));
            ctrl.close();
          },
        });
        return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
      }),
    );
    try {
      const delays: number[] = [];
      const client = new EngineClient("http://press", {
        password: "pw",
        stream: { retryDelay: (attempt) => (delays.push(attempt), 100), steadyMs: 2000 },
      });
      const steady = vi.fn();
      client.onSteady = steady;
      const frames = listen(client);
      for (let i = 0; i < 8; i++) await vi.advanceTimersByTimeAsync(100);
      expect(opened).toBeGreaterThanOrEqual(6);
      // Each drop counts as one more failed reconnect: the attempts climb and are never reset.
      expect(delays.slice(0, 6)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(frames.filter((f) => f.type === "folio.stream-paused")).toHaveLength(1);
      expect(frames.some((f) => f.type === "folio.stream-resumed")).toBe(false);
      expect(frames.filter((f) => f.type === "folio.stream-failing").length).toBeGreaterThanOrEqual(1);
      expect(steady).not.toHaveBeenCalled();
    } finally {
      for (const ctrl of aborts.splice(0)) ctrl.abort();
      vi.unstubAllGlobals();
      vi.useRealTimers();
    }
  });

  it("counts a connection as made once it brings a real event, and tells its owner", async () => {
    const { url } = await press({ flaky: true });
    const client = new EngineClient(url, { password: "pw", stream: { retryDelay: () => 10, steadyMs: 60_000 } });
    const steady = vi.fn();
    client.onSteady = steady;
    const frames = listen(client);
    await until(() => frames.filter((f) => f.type === "server.connected").length === 2);
    expect(steady).not.toHaveBeenCalled();
    await client.prompt(SESSION, "Add a farewell");
    await until(() => frames.some((f) => f.type === "folio.stream-resumed"));
    expect(steady).toHaveBeenCalledTimes(1);
    const resumed = frames.findIndex((f) => f.type === "folio.stream-resumed");
    expect(frames[resumed + 1]?.type).not.toBe("server.connected");
  });

  it("tells its owner when a request finds nothing answering", async () => {
    const onUnreachable = vi.fn();
    const nowhere = new EngineClient("http://127.0.0.1:9", { password: "pw" });
    nowhere.onUnreachable = onUnreachable;
    await expect(nowhere.info()).rejects.toMatchObject({ status: 0 });
    expect(onUnreachable).toHaveBeenCalledTimes(1);
    const { url } = await press();
    const there = new EngineClient(url, { password: "pw" });
    there.onUnreachable = onUnreachable;
    await expect(there.prompt("ses_busy", "hi")).rejects.toMatchObject({ status: 409 });
    expect(onUnreachable).toHaveBeenCalledTimes(1);
  });

  it("gives up on a stream that has gone silent and opens another", async () => {
    const live = await press({ heartbeatMs: 60_000 });
    const client = new EngineClient(live.url, { password: "pw", stream: { silenceMs: 80, retryDelay: () => 10 } });
    const frames = listen(client);
    await until(() => live.streams() >= 2);
    expect(frames.filter((f) => f.type === "folio.stream-paused").length).toBeGreaterThanOrEqual(1);
  });

  it("keeps a stream that only sends heartbeats", async () => {
    const live = await press({ heartbeatMs: 20 });
    const client = new EngineClient(live.url, { password: "pw", stream: { silenceMs: 150, retryDelay: () => 10 } });
    const frames = listen(client);
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(live.streams()).toBe(1);
    expect(frames.map((f) => f.type)).toEqual(["server.connected"]);
  });

  it("answers asks and forms, and sets the model, style and synthetic notes", async () => {
    const { url, requests } = await press();
    const client = new EngineClient(url, { password: "pw" });
    await client.permissionReply(SESSION, "per_1", "reject", "Not now.");
    expect(requests.at(-1)).toMatchObject({ path: `/api/session/${SESSION}/permission/per_1/reply`, body: { decision: "reject", message: "Not now." } });
    await client.formReply(SESSION, "frm_1", { q0: "French" });
    expect(requests.at(-1)).toMatchObject({ path: `/api/session/${SESSION}/form/frm_1/reply`, body: { answer: { q0: "French" } } });
    await client.formCancel(SESSION, "frm_1", "Skipped.");
    expect(requests.at(-1)).toMatchObject({ method: "DELETE", query: { message: "Skipped." } });
    await client.setSessionModel(SESSION, { providerID: "opencode", id: "big-pickle" });
    expect(requests.at(-1)?.body).toEqual({ model: { providerID: "opencode", id: "big-pickle" } });
    expect(await client.interrupt(SESSION)).toBe(true);
    // The replay press has no instruction entries; a 404 there is not an error.
    await expect(client.setInstruction(SESSION, "folio.style", "Write calmly.")).resolves.toBeUndefined();
    await client.synthetic(SESSION, "The reader reverted the change to src/greet.ts.");
    expect(requests.at(-1)?.body).toEqual({ text: "The reader reverted the change to src/greet.ts." });
    expect(await client.activeSessions()).toEqual([]);
    expect((await client.diff(SESSION))[0].file).toBe("src/greet.ts");
    expect((await client.models()).map((m) => m.id)).toEqual(["cat-jam-free", "big-pickle"]);
  });

  it("lists the asks and forms a session is waiting on", async () => {
    const { url, requests } = await press({ pending: true });
    const client = new EngineClient(url, { password: "pw" });
    const asks = await client.permissions(SESSION);
    expect(requests.at(-1)).toMatchObject({ method: "GET", path: `/api/session/${SESSION}/permission` });
    expect(asks.map((a) => a.id)).toEqual(["per_13784ca75001ULlav0hXATVSbe"]);
    expect(asks[0]).toMatchObject({ action: "edit", resources: ["src/greet.ts"] });
    const forms = await client.forms(SESSION);
    expect(requests.at(-1)).toMatchObject({ method: "GET", path: `/api/session/${SESSION}/form` });
    expect(forms.map((f) => f.id)).toEqual(["frm_137858dc2001K01Vv8YDfRjzW1"]);
    expect(await client.permissions("ses_second")).toEqual([]);
    await client.permissionReply(SESSION, asks[0].id, "once");
    await client.formCancel(SESSION, forms[0].id);
    expect(await client.permissions(SESSION)).toEqual([]);
    expect(await client.forms(SESSION)).toEqual([]);
  });

  it("lists key integrations and stores a key", async () => {
    const { url, requests } = await press();
    const client = new EngineClient(url, { password: "pw" });
    const list = await client.integrations();
    expect(list.map((i) => i.id)).toContain("anthropic");
    await client.connectKey("anthropic", "sk-test", "Folio");
    expect(requests.at(-1)).toMatchObject({ path: "/api/integration/anthropic/connect/key", body: { key: "sk-test", label: "Folio" } });
  });

  it("sends no location before a book is open, and the book's folder on every location-scoped call after", async () => {
    const { url, requests } = await press();
    const client = new EngineClient(url, { password: "pw" });
    await client.models();
    await client.providers();
    await client.defaultModel();
    await client.integrations();
    expect(requests.map((r) => r.query["location[directory]"])).toEqual([undefined, undefined, undefined, undefined]);
    client.useDirectory("/book");
    expect(client.directory).toBe("/book");
    await client.models();
    await client.providers();
    await client.defaultModel();
    await client.integrations();
    expect(requests.slice(4).map((r) => [r.path, r.query["location[directory]"]])).toEqual([
      ["/api/model", "/book"],
      ["/api/provider", "/book"],
      ["/api/model/default", "/book"],
      ["/api/integration", "/book"],
    ]);
  });

  it("reads files from the press, and writes through Folio's host before the press's route", async () => {
    const { url, requests } = await press();
    const writeFile = vi.fn(async () => {});
    const client = new EngineClient(url, { password: "pw", host: { writeFile } });
    expect(await client.readFile("/book", "src/greet.ts")).toContain("greet");
    expect(requests.at(-1)).toMatchObject({ path: "/api/fs/read/src/greet.ts", query: { "location[directory]": "/book" } });
    const before = requests.length;
    await client.writeFile("/book", "src/greet.ts", "new text\n");
    expect(writeFile).toHaveBeenCalledWith("/book", "src/greet.ts", "new text\n");
    expect(requests.length).toBe(before);
  });

  it("writes through the press's route only when there is no host write", async () => {
    const { url, requests } = await press();
    const client = new EngineClient(url, { password: "pw" });
    await expect(client.writeFile("/book", "src/greet.ts", "new text\n")).rejects.toMatchObject({ status: 404 });
    expect(requests.at(-1)).toMatchObject({ method: "POST", path: "/api/experimental/fs/write", body: "new text\n" });
    expect(requests.at(-1)?.query).toEqual({ "location[directory]": "/book", path: "src/greet.ts" });
  });

  it("maps failures to calm sentences", async () => {
    const { url } = await press();
    const client = new EngineClient(url, { password: "pw" });
    await client.info();
    await expect(client.writeFile("/book", "a.txt", "x")).rejects.toMatchObject({
      status: 404,
      message: "The press does not know that page (opencode 2.0.28).",
    });
    await expect(client.prompt("ses_busy", "hello")).rejects.toMatchObject({ status: 409, message: "The session is busy." });
    await expect(client.diff("ses_broken")).rejects.toMatchObject({ status: 500, message: "The snapshot store is unreadable." });
    const nowhere = new EngineClient("http://127.0.0.1:9", { password: "pw" });
    await expect(nowhere.info()).rejects.toMatchObject({ status: 0, message: "The press could not be reached." });
  });
});

describe("stream helpers", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("trips the watchdog only after a full silence", () => {
    vi.useFakeTimers();
    const silent = vi.fn();
    const dog = watchdog(45_000, silent);
    vi.advanceTimersByTime(44_000);
    dog.poke();
    vi.advanceTimersByTime(44_000);
    expect(silent).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(silent).toHaveBeenCalledTimes(1);
    dog.stop();
    vi.advanceTimersByTime(100_000);
    expect(silent).toHaveBeenCalledTimes(1);
  });

  it("backs off from 400 ms to 8 s, with jitter", () => {
    expect(backoffDelay(1, () => 0.5)).toBe(400);
    expect(backoffDelay(2, () => 0.5)).toBe(800);
    expect(backoffDelay(10, () => 0.5)).toBe(8000);
    expect(backoffDelay(10, () => 1)).toBe(8000);
    expect(backoffDelay(1, () => 0)).toBe(320);
  });
});
