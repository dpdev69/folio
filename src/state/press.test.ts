import { afterEach, describe, expect, it } from "vitest";
import { startReplay, type Replay } from "../../scripts/replay-press.mjs";
import type { Book, Chapter, Plate } from "../book/model";
import { EngineClient } from "../engine/client";
import { CANNOT_REVERT, revertPlate } from "./press";

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

describe("revertPlate", () => {
  it("refuses, without touching the file, when the press will not scope the diff to the plate's turn", async () => {
    const { replay, client } = await press();
    const ch = chapter();
    // An assistant id: the press answers 400, "not a user message".
    const p = plate({ turnMessageId: "msg_137831fee001iiy0rpghC3oXA3" });
    await expect(revertPlate(client, book([ch]), ch, p)).rejects.toThrow(CANNOT_REVERT);
    const diffs = replay.requests.filter((r) => r.path.endsWith("/diff"));
    expect(diffs.map((r) => r.query.from)).toEqual(["msg_137831fee001iiy0rpghC3oXA3"]);
    expect(replay.requests.some((r) => r.path.startsWith("/api/fs/") || r.path.endsWith("/synthetic"))).toBe(false);
  });

  it("refuses a plate that does not know its turn", async () => {
    const { replay, client } = await press();
    const ch = chapter();
    await expect(revertPlate(client, book([ch]), ch, plate())).rejects.toThrow(CANNOT_REVERT);
    expect(replay.requests.length).toBe(0);
  });
});
