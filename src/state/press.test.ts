import { afterEach, describe, expect, it } from "vitest";
import { startReplay, type Replay } from "../../scripts/replay-press.mjs";
import type { Book, Chapter, Plate } from "../book/model";
import { EngineClient } from "../engine/client";
import { CANNOT_REVERT, defaultModelChoice, loadBook, offeredModels, refreshBook, revertNote, revertPlate, turnDiff } from "./press";

const DIRECTORY = "/private/tmp/claude-501/-Users-me-folio/e9197d91-01d7-4355-b22f-541229eaf5c7/scratchpad/v2/repo";
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

  it("marks the whole session's diff as unscoped when the press will not scope it", async () => {
    const { client } = await press();
    const refused = await turnDiff(client, chapter({ blocks: [ink("msg_not_a_user_message")] }));
    expect(refused.data).toMatchObject({ unscoped: true });
    const unnamed = await turnDiff(client, chapter({ blocks: [ink("local-1")] }));
    expect(unnamed.data).toMatchObject({ unscoped: true });
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
    expect(defaultModelChoice(null, offeredModels(listed))).toEqual({ model: null });
  });
});
