import { afterEach, describe, expect, it, vi } from "vitest";
import { startReplay, type Replay } from "../../scripts/replay-press.mjs";
import { applyEvent } from "../book/events";
import type { Book } from "../book/model";
import { chapterFromMessages } from "../book/transcript";
import { EngineClient, EngineError } from "./client";
import { backoffDelay, watchdog, type EventFrame } from "./sse";

const DIRECTORY = "/private/tmp/claude-501/-Users-me-folio/e9197d91-01d7-4355-b22f-541229eaf5c7/scratchpad/v2/repo";
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
    expect(listed.map((r) => r.query.cursor)).toEqual([undefined, "page2"]);
    expect(listed[0].query.directory).toBe(DIRECTORY);
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
    const empty: Book = { id: DIRECTORY, title: "repo", directory: DIRECTORY, sample: false, chapters: [] };
    const book = frames.reduce(applyEvent, empty);
    const chapter = book.chapters[0];
    expect(chapter.blocks.some((b) => b.text.startsWith("Added a `farewell(name)`"))).toBe(true);
    expect(chapter.footnotes.length).toBeGreaterThan(0);
    expect(chapter.busy).toBe(false);
  });

  it("reconnects after the stream drops, pausing once and resuming", async () => {
    const { url } = await press({ flaky: true });
    const client = new EngineClient(url, { password: "pw", stream: { retryDelay: () => 10 } });
    const frames = listen(client);
    await until(() => frames.filter((f) => f.type === "server.connected").length === 2);
    expect(frames.map((f) => f.type)).toEqual([
      "server.connected",
      "folio.stream-paused",
      "folio.stream-resumed",
      "server.connected",
    ]);
    expect(frames[1].data?.message).toBeTruthy();
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

  it("lists key integrations and stores a key", async () => {
    const { url, requests } = await press();
    const client = new EngineClient(url, { password: "pw" });
    const list = await client.integrations();
    expect(list.map((i) => i.id)).toContain("anthropic");
    await client.connectKey("anthropic", "sk-test", "Folio");
    expect(requests.at(-1)).toMatchObject({ path: "/api/integration/anthropic/connect/key", body: { key: "sk-test", label: "Folio" } });
  });

  it("reads files from the press and writes through the host when the press cannot", async () => {
    const { url, requests } = await press();
    const writeFile = vi.fn(async () => {});
    const client = new EngineClient(url, { password: "pw", host: { writeFile } });
    expect(await client.readFile("/book", "src/greet.ts")).toContain("greet");
    expect(requests.at(-1)).toMatchObject({ path: "/api/fs/read/src/greet.ts", query: { "location[directory]": "/book" } });
    await client.writeFile("/book", "src/greet.ts", "new text\n");
    expect(requests.at(-1)).toMatchObject({ method: "POST", path: "/api/experimental/fs/write", body: "new text\n" });
    expect(requests.at(-1)?.query).toEqual({ "location[directory]": "/book", path: "src/greet.ts" });
    expect(writeFile).toHaveBeenCalledWith("/book", "src/greet.ts", "new text\n");
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
