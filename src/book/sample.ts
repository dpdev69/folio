import type { Book, Chapter } from "./model";
import { plateLines } from "./diff";

const PREFIX = Array.from({ length: 11 }, (_, i) => `// context ${i + 1}`).join("\n");
const BEFORE = `${PREFIX}\nbeforeEach(() => {\n  const token = mint();\n  useFakeTimers();\n});\n`;
const AFTER = `${PREFIX}\nbeforeEach(() => {\n  useFakeTimers();\n  setSystemTime(T₀);\n  const token = mint();\n});\n`;

function chapter(partial: Pick<Chapter, "id" | "title" | "untitled"> & Partial<Chapter>): Chapter {
  return {
    blocks: [],
    footnotes: [],
    plates: [],
    notes: [],
    asks: [],
    busy: false,
    ...partial,
  };
}

/** The api-server sample, set so the three mockup scenes are real pages. */
export function sampleBook(): Book {
  const plateLineset = plateLines(BEFORE, AFTER, { context: 1, maxLines: 20 });
  const iv = chapter({
    id: "ch-iv",
    title: "The flaky login test",
    untitled: false,
    blocks: [
      {
        id: "iv-open",
        voice: "prose",
        text: [
          "The test failed only on the build server, and only on some mornings. That was the clue. Locally the clock is real; in CI it is mocked, and the mock was installed *after* the session token had already been minted, so every token was born a few milliseconds in the past.",
          "I moved the clock into the fixture, so time is frozen before anything is created, and ran the suite forty times in a row. It passed every time. The change is three lines; you'll find it set out as Plate 3 at the end of this chapter.",
          "There is one loose thread. The refresh logic in *auth/refresh* retries with a backoff that can stretch to thirty seconds, which would quietly hide the same class of bug again. I'd tighten it next, if you agree.",
          "Shall I cap the backoff at two seconds and add a small circuit breaker, or would you rather keep the current window and simply log when it is reached?",
        ].join("\n\n"),
      },
      {
        id: "iv-tools",
        voice: "prose",
        text: [
          "I began by running the authentication tests forty times in a row to see how often the failure appeared; three runs failed, always in the same assertion. Reading the fixture made the cause plain: the clock was frozen one line too late.",
          "I reordered the setup so time stops before any token is minted and ran the suite again. All forty runs passed.",
        ].join("\n\n"),
      },
      {
        id: "iv-margin",
        voice: "prose",
        text: [
          "With the clock fixed, I turned to the refresh path. It now wraps every refresh in an exponential backoff with jitter, capped at thirty seconds, so a struggling auth server is never stampeded.",
          "The cache needed similar care. Writes now invalidate entries keyed by tenant and route, while a small secondary least-recently-used table keeps the hottest paths warm between invalidations, trading a little memory for steadier latency under load.",
          "Both changes are covered by the suite, and neither alters a public interface. What remains is mostly a question of taste.",
        ].join("\n\n"),
      },
    ],
    footnotes: [
      {
        id: "fn1",
        n: 1,
        blockId: "iv-tools",
        offset: 148,
        text: "Ran npm test — auth, repeated forty times. 3 of 40 failed · 12.4 s.",
      },
      {
        id: "fn2",
        n: 2,
        blockId: "iv-tools",
        offset: 230,
        text: "Read tests/fixtures/session.ts, lines 1–40.",
      },
      {
        id: "fn3",
        n: 3,
        blockId: "iv-tools",
        offset: 360,
        text: "Edited the same file, two lines removed and three added. See Plate 3 →",
        plateId: "plate-3",
      },
      {
        id: "fn4",
        n: 4,
        blockId: "iv-tools",
        offset: 430,
        text: "Ran the suite again. 40 of 40 passed · 11.9 s.",
      },
    ],
    plates: [
      {
        id: "plate-3",
        n: 3,
        file: "tests/fixtures/session.ts",
        title: "The session fixture, before and after",
        caption: "Fig. 3. The clock now stops before the token is born.",
        lines: plateLineset,
        additions: 3,
        deletions: 2,
        status: "open",
        folded: false,
      },
    ],
    notes: [
      {
        id: "note-why",
        quote: "wraps every refresh in an exponential backoff with jitter, capped at thirty seconds",
        prompt: "why thirty?",
        reply:
          "Because the upstream rate-limit window is thirty seconds, so waiting any longer gains nothing. That said, two seconds plus a circuit breaker would fail faster and feel better. Shall I?",
      },
      {
        id: "note-short",
        quote:
          "Writes now invalidate entries keyed by tenant and route, while a small secondary least-recently-used table keeps the hottest paths warm between invalidations, trading a little memory for steadier latency under load.",
        prompt: "shorter",
        reply: "Writes invalidate per tenant and route; the hottest paths stay in a small LRU.",
      },
    ],
  });

  return {
    id: "api-server",
    title: "api-server",
    directory: "",
    sample: true,
    chapters: [
      chapter({
        id: "ch-i",
        title: "Scaffolding the REST layer",
        untitled: false,
        blocks: [
          {
            id: "i-1",
            voice: "prose",
            text: "The service began as a single file and a promise to split it later. Later arrived on a Thursday, with three clients already depending on the shape of the URLs. I drew the boundary at the resource, not the framework, so a handler knows its noun and nothing about the socket.",
          },
        ],
      }),
      chapter({
        id: "ch-ii",
        title: "The migration that ate Tuesday",
        untitled: false,
        blocks: [
          {
            id: "ii-1",
            voice: "prose",
            text: "Tuesday's migration rewrote the sessions table in place. It held a lock just long enough to miss the health check, and the orchestrator, helpful as ever, restarted the process halfway through. The second attempt found a column that was both there and not.",
          },
        ],
      }),
      chapter({
        id: "ch-iii",
        title: "Teaching the cache to forget",
        untitled: false,
        blocks: [
          {
            id: "iii-1",
            voice: "prose",
            text: "The cache was correct and still wrong. It remembered a tenant after the tenant had been deleted, because the invalidation traveled through a queue that only ran when someone was watching. I made forgetting the default and remembering the thing you opt into.",
          },
        ],
      }),
      iv,
      chapter({
        id: "ch-v",
        title: "Untitled",
        untitled: true,
        blocks: [],
      }),
    ],
  };
}

export const SAMPLE_DRAFT =
  "Cap it at two seconds. And add a test that would have caught this, so it can't creep back in";

export function sampleReply(prompt: string): string {
  if (/two seconds|circuit/i.test(prompt)) {
    return [
      "I capped the backoff at two seconds, and I set a circuit breaker beside it so a sick upstream fails in the open instead of hiding inside a retry.",
      "The regression test freezes the clock, mints the token only after that, and then trips the breaker on the third failure. It would have caught the morning bug, and it will catch the next one that tries to creep back in.",
      "The change is small enough to read on one plate. I can set it in the repository whenever you turn the page.",
    ].join("\n\n");
  }
  return "This is the sample press, bound from the api-server chapter so the pages can turn without a model. Open a folder once opencode is running, and the next chapter will be written by the press itself.";
}

export function sampleNoteReply(prompt: string): string {
  const word = prompt.trim().toLowerCase();
  if (word === "why" || word.startsWith("why")) {
    return "Because the upstream rate-limit window is thirty seconds, so waiting any longer gains nothing. That said, two seconds plus a circuit breaker would fail faster and feel better. Shall I?";
  }
  if (word === "shorter") return "Writes invalidate per tenant and route; the hottest paths stay in a small LRU.";
  if (word.includes("another")) {
    return "Keep the thirty-second cap, and log when a retry crosses two seconds, so the slowness is visible without failing the call.";
  }
  if (word === "yes") return "Then I will cap the backoff at two seconds and add the regression test.";
  return sampleReply(prompt);
}

export const SAMPLE_BREAKS: Record<string, string[]> = {
  "ch-iv": ["iv-tools", "iv-margin"],
};
