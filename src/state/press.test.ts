import { afterEach, describe, expect, it } from "vitest";
import { REPLAY_DIRECTORY, startReplay, type Replay } from "../../scripts/replay-press.mjs";
import type { Book, Chapter, Plate } from "../book/model";
import { EngineClient } from "../engine/client";
import {
  applyAskRules,
  ASK_RULES,
  asksFirst,
  CANNOT_REVERT,
  defaultModelChoice,
  loadAskBeforeWrite,
  loadBook,
  loadChosenModel,
  mapLimit,
  NOT_SET_YET,
  NOT_TOLD,
  offeredModels,
  openChapter,
  REFRESH_LIMIT,
  RUNNING_UNKNOWN,
  STYLE_MISSED,
  refreshBook,
  revertNote,
  revertPlate,
  saveAskBeforeWrite,
  saveChosenModel,
  turnDiff,
} from "./press";

const DIRECTORY = REPLAY_DIRECTORY;
const SESSION = "ses_ec87ce784ffeufwpMch0VZPNfx";

let replay: Replay | undefined;

afterEach(async () => {
  await replay?.close();
  replay = undefined;
});

async function press() {
  replay = await startReplay({ password: "pw" });
  return { replay, client: new EngineClient(replay.url, { password: "pw" }) };
}

function chapter(over: Partial<Chapter> = {}): Chapter {
  return { id: SESSION, title: "t", untitled: false, blocks: [], footnotes: [], plates: [], notes: [], asks: [], forms: [], busy: false, ...over };
}

function plate(over: Partial<Plate> = {}): Plate {
  return { id: "p1", n: 1, file: "src/greet.ts", title: "", caption: "", lines: [], additions: 4, deletions: 0, status: "open", folded: false, ...over };
}

const book = (chapters: Chapter[]): Book => ({ id: DIRECTORY, title: "repo", directory: DIRECTORY, sample: false, chapters });

describe("turnDiff", () => {
  const ink = (id: string) => ({ id, voice: "ink" as const, text: "Go." });

  it("scopes the diff to the turn's user message", async () => {
    const { replay, client } = await press();
    const frame = await turnDiff(client, chapter({ blocks: [ink("msg_1378318cd0011en9zAGWcvx4bC")] }));
    expect(frame.data).toMatchObject({ turnMessageId: "msg_1378318cd0011en9zAGWcvx4bC" });
    expect((frame.data as { unscoped?: boolean }).unscoped).toBeUndefined();
    expect(replay.requests.filter((r) => r.path.endsWith("/diff"))).toHaveLength(1);
  });

  it("never labels the whole session's diff as a turn's", async () => {
    const { replay, client } = await press();
    const refused = await turnDiff(client, chapter({ blocks: [ink("msg_not_a_user_message")] }));
    expect(refused.data).toMatchObject({ diff: [], unscoped: true });
    const unnamed = await turnDiff(client, chapter({ blocks: [ink("local-1")] }));
    expect(unnamed.data).toMatchObject({ diff: [], unscoped: true });
    // Only the refused turn asked; the unnamed one was not sent at all, and nothing fell back to the session.
    const asked = replay.requests.filter((r) => r.path.endsWith("/diff"));
    expect(asked.map((r) => r.query.from)).toEqual(["msg_not_a_user_message"]);
  });

  it("gives a chapter with no turn at all the session's diff, naming no turn", async () => {
    const { client } = await press();
    const frame = await turnDiff(client, chapter());
    expect(frame.data).toMatchObject({ unscoped: true });
    expect((frame.data as { diff: unknown[] }).diff.length).toBeGreaterThan(0);
    expect((frame.data as { turnMessageId?: string }).turnMessageId).toBeUndefined();
  });

  it("scopes to the turn it is given rather than the chapter's latest", async () => {
    const { replay, client } = await press();
    const frame = await turnDiff(client, chapter({ blocks: [ink("local-9")] }), "msg_1378318cd0011en9zAGWcvx4bC");
    expect(frame.data).toMatchObject({ turnMessageId: "msg_1378318cd0011en9zAGWcvx4bC" });
    expect(replay.requests.filter((r) => r.path.endsWith("/diff")).map((r) => r.query.from)).toEqual(["msg_1378318cd0011en9zAGWcvx4bC"]);
  });
});

describe("revertPlate", () => {
  const GREET = "export function greet(name: string): string {\n  return `Hello, ${name}!`;\n}\n";
  /** The replay press serves GREET as the file now; this patch renamed hello to greet. */
  const RENAME = "@@ -1,3 +1,3 @@\n-export function hello(name: string): string {\n+export function greet(name: string): string {\n   return `Hello, ${name}!`;\n }\n";

  async function hosted() {
    replay = await startReplay({ password: "pw" });
    const written: { path: string; content: string }[] = [];
    const host = { writeFile: async (_dir: string, path: string, content: string) => void written.push({ path, content }) };
    return { replay, written, client: new EngineClient(replay.url, { password: "pw", host }) };
  }

  it("reverses the plate's own patch against the file as it is now, and tells the model", async () => {
    const { replay, written, client } = await hosted();
    const ch = chapter();
    await revertPlate(client, book([ch]), ch, plate({ patch: RENAME, turnMessageId: "msg_1378318cd0011en9zAGWcvx4bC" }));
    expect(written).toEqual([{ path: "src/greet.ts", content: GREET.replace("greet(", "hello(") }]);
    const told = replay.requests.find((r) => r.path.endsWith("/synthetic"));
    expect((told?.body as { text?: string })?.text).toBe(revertNote("src/greet.ts"));
  });

  it("leaves a file that has moved on as it is", async () => {
    const { written, client } = await hosted();
    const ch = chapter();
    const moved = RENAME.replace("+export function greet", "+export function wave");
    await expect(revertPlate(client, book([ch]), ch, plate({ patch: moved }))).rejects.toThrow("has changed since");
    expect(written).toEqual([]);
  });

  it("refuses a plate without a patch of its own, without touching anything", async () => {
    const { replay, client } = await press();
    const ch = chapter();
    await expect(revertPlate(client, book([ch]), ch, plate({ turnMessageId: "msg_1378318cd0011en9zAGWcvx4bC" }))).rejects.toThrow(
      CANNOT_REVERT,
    );
    expect(replay.requests.length).toBe(0);
  });

  it("asks for a moment when the plate's turn is not named yet", async () => {
    const { replay, client } = await press();
    const ch = chapter();
    await expect(revertPlate(client, book([ch]), ch, plate({ turnMessageId: "local-1760918400000" }))).rejects.toThrow(NOT_SET_YET);
    expect(replay.requests.length).toBe(0);
  });
});

describe("revertPlate on a new or a removed file", () => {
  const NEW = "diff --git a/src/new.ts b/src/new.ts\nnew file mode 100644\n--- /dev/null\n+++ b/src/new.ts\n@@ -0,0 +1,2 @@\n+export const a = 1;\n+export const b = 2;\n";
  const GONE = "diff --git a/src/gone.ts b/src/gone.ts\ndeleted file mode 100644\n--- a/src/gone.ts\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-export const a = 1;\n-export const b = 2;\n";

  async function hosted(files: Record<string, string>) {
    replay = await startReplay({ password: "pw", files });
    const calls: string[] = [];
    const host = {
      writeFile: async (_dir: string, path: string, content: string) => void calls.push(`write ${path} ${JSON.stringify(content)}`),
      readFile: async (_dir: string, path: string): Promise<string> => {
        calls.push(`read ${path}`);
        throw new Error(`ENOENT: no such file or directory, open '${path}'`);
      },
      removeFile: async (_dir: string, path: string) => void calls.push(`remove ${path}`),
    };
    return { calls, client: new EngineClient(replay.url, { password: "pw", host }) };
  }

  it("removes a file the plate created, rather than leaving it empty", async () => {
    const { calls, client } = await hosted({ "src/new.ts": "export const a = 1;\nexport const b = 2;\n" });
    const ch = chapter();
    await revertPlate(client, book([ch]), ch, plate({ file: "src/new.ts", patch: NEW, change: "added" }));
    expect(calls).toEqual(["remove src/new.ts"]);
  });

  it("removes a new file when only the patch says it is new", async () => {
    const { calls, client } = await hosted({ "src/new.ts": "export const a = 1;\nexport const b = 2;\n" });
    const ch = chapter();
    await revertPlate(client, book([ch]), ch, plate({ file: "src/new.ts", patch: NEW }));
    expect(calls).toEqual(["remove src/new.ts"]);
  });

  it("leaves a new file alone once more was written to it", async () => {
    const { calls, client } = await hosted({ "src/new.ts": "export const a = 1;\nexport const b = 2;\nexport const c = 3;\n" });
    const ch = chapter();
    await expect(revertPlate(client, book([ch]), ch, plate({ file: "src/new.ts", patch: NEW, change: "added" }))).rejects.toThrow("has changed since");
    expect(calls).toEqual([]);
  });

  it("writes a removed file back from the patch when it is missing", async () => {
    const { calls, client } = await hosted({});
    const ch = chapter();
    await revertPlate(client, book([ch]), ch, plate({ file: "src/gone.ts", patch: GONE, change: "deleted" }));
    expect(calls).toEqual(["read src/gone.ts", `write src/gone.ts ${JSON.stringify("export const a = 1;\nexport const b = 2;\n")}`]);
  });

  it("leaves a removed file alone if something has been written in its place", async () => {
    const { calls, client } = await hosted({ "src/gone.ts": "something new\n" });
    const ch = chapter();
    await expect(revertPlate(client, book([ch]), ch, plate({ file: "src/gone.ts", patch: GONE, change: "deleted" }))).rejects.toThrow("has changed since");
    expect(calls).toEqual([]);
  });
});

describe("pending asks and forms", () => {
  it("are set on open, through the same reducer paths as the events", async () => {
    replay = await startReplay({ password: "pw", pending: true });
    const client = new EngineClient(replay.url, { password: "pw" });
    const opened = await loadBook(client, DIRECTORY, { askBeforeWrite: true });
    const first = opened.chapters.find((c) => c.id === SESSION)!;
    expect(first.asks).toEqual([
      expect.objectContaining({ id: "per_13784ca75001ULlav0hXATVSbe", permission: "edit", title: "May I edit src/greet.ts?" }),
    ]);
    expect(first.asks[0].patch).toContain("farewell");
    expect(first.forms).toEqual([expect.objectContaining({ id: "frm_137858dc2001K01Vv8YDfRjzW1", title: "Questions" })]);
    expect(first.forms[0].fields[0]).toMatchObject({ key: "q0", title: "Greet language" });
    const second = opened.chapters.find((c) => c.id === "ses_second")!;
    expect(second.asks).toEqual([]);
    expect(second.forms).toEqual([]);
  });

  it("replace what the chapter held after an outage, and keep it when the press cannot list them", async () => {
    replay = await startReplay({ password: "pw", pending: true });
    const client = new EngineClient(replay.url, { password: "pw" });
    const stale = { id: "per_answered_elsewhere", permission: "edit", patterns: [], title: "May I edit a.ts?" };
    const staleForm = { id: "frm_gone", title: "Old", fields: [] };
    const held = chapter({ asks: [stale], forms: [staleForm] });
    const broken = chapter({ id: "ses_broken", asks: [stale], forms: [staleForm] });
    const fresh = await refreshBook(client, book([held, broken]));
    expect(fresh.chapters[0].asks.map((a) => a.id)).toEqual(["per_13784ca75001ULlav0hXATVSbe"]);
    expect(fresh.chapters[0].forms.map((f) => f.id)).toEqual(["frm_137858dc2001K01Vv8YDfRjzW1"]);
    expect(fresh.chapters[1].asks).toEqual([stale]);
    expect(fresh.chapters[1].forms).toEqual([staleForm]);
  });
});

const listed = [
  { providerID: "anthropic", id: "claude-x", name: "Claude X", status: "active", enabled: true },
  { providerID: "opencode", id: "exo-free", name: "Exo Free", status: "deprecated", enabled: true },
  { providerID: "opencode", id: "cat-jam-free", name: "Cat Jam Free", status: "active", enabled: true },
  { providerID: "opencode", id: "big-pickle", name: "Big Pickle", status: "active", enabled: false },
];

describe("the press's models", () => {
  it("offers only the models that are active and enabled", () => {
    expect(offeredModels(listed).map((m) => m.id)).toEqual(["claude-x", "cat-jam-free"]);
    expect(offeredModels([{ providerID: "opencode", id: "plain" }]).map((m) => m.id)).toEqual(["plain"]);
  });

  it("keeps a default the press still offers", () => {
    const choice = defaultModelChoice({ providerID: "anthropic", id: "claude-x" }, offeredModels(listed));
    expect(choice).toEqual({ model: { providerID: "anthropic", id: "claude-x" } });
  });

  it("chooses the first free model for a default that is gone, and says so", () => {
    const choice = defaultModelChoice({ providerID: "opencode", id: "exo-free" }, offeredModels(listed));
    expect(choice).toEqual({
      model: { providerID: "opencode", id: "cat-jam-free" },
      note: "The press's default model, exo-free, is no longer offered, so Folio chose Cat Jam Free.",
    });
  });

  it("leaves the default alone when there is no list to check it against or no free model", () => {
    const gone = { providerID: "opencode", id: "exo-free" };
    expect(defaultModelChoice(gone, [])).toEqual({ model: gone });
    expect(defaultModelChoice(gone, [listed[0]])).toEqual({ model: gone });
    expect(defaultModelChoice(null, [])).toEqual({ model: null });
    expect(defaultModelChoice(null, [listed[0]])).toEqual({ model: null });
  });

  it("treats a press that names no default as offering none, and falls back to a free model", () => {
    expect(defaultModelChoice(null, offeredModels(listed))).toEqual({
      model: { providerID: "opencode", id: "cat-jam-free" },
      note: "The press named no default model, so Folio chose Cat Jam Free.",
    });
  });

  it("offers models with no status, and alpha or beta ones, but not deprecated or disabled ones", () => {
    const more = [
      { providerID: "opencode", id: "plain" },
      { providerID: "opencode", id: "early", status: "beta" },
      { providerID: "opencode", id: "earlier", status: "alpha" },
      { providerID: "opencode", id: "old", status: "deprecated" },
      { providerID: "opencode", id: "off", enabled: false },
    ];
    expect(offeredModels(more).map((m) => m.id)).toEqual(["plain", "early", "earlier"]);
  });

  it("prefers the model the reader chose last time, while the press still offers it", () => {
    const offered = offeredModels(listed);
    const chosen = { providerID: "anthropic", id: "claude-x" };
    expect(defaultModelChoice({ providerID: "opencode", id: "cat-jam-free" }, offered, chosen)).toEqual({ model: chosen });
    expect(defaultModelChoice({ providerID: "opencode", id: "exo-free" }, offered, chosen)).toEqual({ model: chosen });
    const gone = { providerID: "opencode", id: "big-pickle" };
    expect(defaultModelChoice({ providerID: "anthropic", id: "claude-x" }, offered, gone)).toEqual({
      model: { providerID: "anthropic", id: "claude-x" },
    });
  });
});

describe("the reader's model", () => {
  function memory() {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    };
  }

  it("is kept under folio.model and read back, and nothing breaks when storage does", () => {
    const storage = memory();
    expect(loadChosenModel(storage)).toBeNull();
    saveChosenModel({ providerID: "opencode", id: "big-pickle" }, storage);
    expect(JSON.parse(storage.data.get("folio.model")!)).toEqual({ providerID: "opencode", id: "big-pickle" });
    expect(loadChosenModel(storage)).toEqual({ providerID: "opencode", id: "big-pickle" });
    storage.data.set("folio.model", '{"providerID": 4}');
    expect(loadChosenModel(storage)).toBeNull();
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => undefined,
    };
    expect(loadChosenModel(broken)).toBeNull();
    expect(() => saveChosenModel({ providerID: "opencode", id: "x" }, broken)).not.toThrow();
  });
});

describe("asking before the press writes", () => {
  it("reads a chapter's own rules: the last rule for edits decides", () => {
    expect(asksFirst(ASK_RULES)).toBe(true);
    expect(asksFirst([{ action: "*", resource: "*", effect: "ask" }])).toBe(true);
    expect(asksFirst([])).toBe(false);
    expect(asksFirst(undefined)).toBe(false);
    expect(asksFirst([{ action: "shell", resource: "*", effect: "ask" }])).toBe(false);
    expect(asksFirst([...ASK_RULES, { action: "edit", resource: "*", effect: "allow" }])).toBe(false);
  });

  it("sets the rules on every chapter it is given: ask rules on, an empty list off", async () => {
    const { replay, client } = await press();
    const on = await applyAskRules(client, [SESSION, "ses_second"], true);
    expect(on).toEqual({ done: [SESSION, "ses_second"], failed: [] });
    const off = await applyAskRules(client, [SESSION, "ses_missing"], false);
    expect(off).toEqual({ done: [SESSION], failed: ["ses_missing"] });
    const patches = replay.requests.filter((r) => r.method === "PATCH");
    expect(patches.map((r) => [r.path, r.body])).toEqual([
      [`/api/session/${SESSION}`, { permissions: ASK_RULES }],
      ["/api/session/ses_second", { permissions: ASK_RULES }],
      [`/api/session/${SESSION}`, { permissions: [] }],
      ["/api/session/ses_missing", { permissions: [] }],
    ]);
  });

  it("gives an open book's chapters the rules when the reader asked for them, and says which chapters hold them", async () => {
    const { replay, client } = await press();
    const plain = await loadBook(client, DIRECTORY, { askBeforeWrite: false });
    expect(plain.chapters.map((c) => c.askRules)).toEqual([false, false]);
    expect(replay.requests.some((r) => r.method === "PATCH")).toBe(false);
    const asking = await loadBook(client, DIRECTORY, { askBeforeWrite: true });
    expect(asking.chapters.map((c) => c.askRules)).toEqual([true, true]);
    // The press keeps them; a second open finds them and patches nothing more.
    const before = replay.requests.filter((r) => r.method === "PATCH").length;
    const again = await loadBook(client, DIRECTORY, { askBeforeWrite: true });
    expect(again.chapters.map((c) => c.askRules)).toEqual([true, true]);
    expect(replay.requests.filter((r) => r.method === "PATCH").length).toBe(before);
  });

  it("is remembered under folio.askBeforeWrite, and nothing breaks when storage does", () => {
    const data = new Map<string, string>();
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
    expect(loadAskBeforeWrite(storage)).toBe(false);
    saveAskBeforeWrite(true, storage);
    expect(data.get("folio.askBeforeWrite")).toBe("true");
    expect(loadAskBeforeWrite(storage)).toBe(true);
    saveAskBeforeWrite(false, storage);
    expect(loadAskBeforeWrite(storage)).toBe(false);
    const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("quota"); }, removeItem: () => undefined };
    expect(loadAskBeforeWrite(broken)).toBe(false);
    expect(() => saveAskBeforeWrite(true, broken)).not.toThrow();
  });
});

describe("reading every chapter again", () => {
  it("reads a few chapters at a time and keeps the book's order", async () => {
    let live = 0;
    let most = 0;
    const done = await mapLimit([50, 10, 30, 0, 20, 5, 40], REFRESH_LIMIT, async (ms, i) => {
      live += 1;
      most = Math.max(most, live);
      await new Promise((resolve) => setTimeout(resolve, ms));
      live -= 1;
      return i;
    });
    expect(done).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(most).toBe(REFRESH_LIMIT);
    expect(await mapLimit([], 4, async () => 1)).toEqual([]);
  });

  it("refreshes chapters in order and says when the press will not name its running chapters", async () => {
    const { client } = await press();
    client.activeSessions = async () => {
      throw new Error("no");
    };
    const notices: string[] = [];
    const ids = [SESSION, "ses_a", "ses_b", "ses_c", "ses_d", "ses_e"];
    const fresh = await refreshBook(client, book(ids.map((id) => chapter({ id }))), { onNotice: (n) => notices.push(n) });
    expect(fresh.chapters.map((c) => c.id)).toEqual(ids);
    expect(notices).toEqual([RUNNING_UNKNOWN]);
  });
});

describe("steps that go on without something say so", () => {
  it("says when the press would not take the style, and stays silent when it has no such route", async () => {
    const { client } = await press();
    const notices: string[] = [];
    // The replay press has no instruction route: a 404, silent by design.
    await openChapter(client, DIRECTORY, { askBeforeWrite: false, onNotice: (n) => notices.push(n) });
    expect(notices).toEqual([]);
    client.setInstruction = async () => {
      throw new Error("The press stumbled.");
    };
    const session = await openChapter(client, DIRECTORY, { askBeforeWrite: false, onNotice: (n) => notices.push(n) });
    expect(session.id).toBeTruthy();
    expect(notices).toEqual([STYLE_MISSED]);
  });

  it("says when a Reject restored the file but the model was not told", async () => {
    replay = await startReplay({ password: "pw" });
    const written: string[] = [];
    const client = new EngineClient(replay.url, { password: "pw", host: { writeFile: async (_d, path) => void written.push(path) } });
    client.synthetic = async () => {
      throw new Error("The press stumbled.");
    };
    const notices: string[] = [];
    const RENAME = "@@ -1,3 +1,3 @@\n-export function hello(name: string): string {\n+export function greet(name: string): string {\n   return `Hello, ${name}!`;\n }\n";
    const ch = chapter();
    await revertPlate(client, book([ch]), ch, plate({ patch: RENAME }), { onNotice: (n) => notices.push(n) });
    expect(written).toEqual(["src/greet.ts"]);
    expect(notices).toEqual([NOT_TOLD]);
    // The host wrote it: the press's experimental write route was never asked.
    expect(replay.requests.some((r) => r.path === "/api/experimental/fs/write")).toBe(false);
  });
});
