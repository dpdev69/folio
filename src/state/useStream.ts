import { useEffect, useRef, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { applyEvent } from "../book/events";
import type { Book, Chapter } from "../book/model";
import type { EngineClient } from "../engine/client";
import { coalesce } from "../engine/coalesce";
import type { EventFrame } from "../engine/sse";
import { withKeptPlates } from "./plateStore";
import { refreshBook, RESYNC_FAILED } from "./press";
import { mergeResync } from "./resync";

export type StreamDeps = {
  setBook: Dispatch<SetStateAction<Book | null>>;
  bookRef: MutableRefObject<Book | null>;
  setNotice: (notice: string | null) => void;
  /** The stream keeps failing: the press may have died. */
  onFailing: () => void;
};

type Queue = ReturnType<typeof coalesce<EventFrame>>;

/**
 * The open book's event stream: listen to it, set its frames in type once
 * per frame, say when it pauses, and read the book again when it returns.
 * Local changes to the book go through `editBook`, so they keep their place
 * after the frames that reached the page before them.
 */
export function useStream(deps: StreamDeps) {
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const abortRef = useRef<AbortController | null>(null);
  const queueRef = useRef<Queue | null>(null);
  // Whether the stream is in an outage, and the frames that reached the page while a resync read the history.
  const pausedRef = useRef(false);
  const resyncRef = useRef<{ frames: EventFrame[]; again: boolean; signal: AbortSignal } | null>(null);
  // chapter id → the assistant message whose finished step made the chapter's diff stale.
  const staleSteps = useRef(new Map<string, string>());

  /** Stop listening to the open book's stream. */
  function stop() {
    abortRef.current?.abort();
    abortRef.current = null;
    queueRef.current = null;
  }

  // The stream ends with the hook that listens to it.
  useEffect(() => () => stop(), []);

  /** A local change to the book, after any frames still waiting to be set. */
  function editBook(edit: SetStateAction<Book | null>) {
    const queue = queueRef.current;
    if (queue) queue.after(() => depsRef.current.setBook(edit));
    else depsRef.current.setBook(edit);
  }

  /** Listen to the press's stream for the open book, in place of any earlier stream. */
  function listen(client: EngineClient): AbortSignal {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    pausedRef.current = false;
    // Many deltas arrive per frame; set them in type together, in order.
    const events = coalesce<EventFrame>((batch) => {
      // A resync reading the history applies these again to the chapters it brings back.
      if (resyncRef.current?.signal === ctrl.signal) resyncRef.current.frames.push(...batch);
      for (const frame of batch) noteStaleStep(frame);
      depsRef.current.setBook((current) => {
        if (!current || current.sample) return current;
        return batch.reduce((book, frame) => applyEvent(book, frame), current);
      });
    });
    queueRef.current = events;
    ctrl.signal.addEventListener("abort", () => {
      events.cancel();
      if (queueRef.current === events) queueRef.current = null;
    });
    client.subscribe((frame) => {
      if (frame.type === "folio.stream-paused") {
        pausedRef.current = true;
        depsRef.current.setNotice("The event stream paused. Folio will listen again.");
      } else if (frame.type === "folio.stream-resumed") {
        pausedRef.current = false;
        depsRef.current.setNotice(null);
        void resync(client, ctrl.signal);
      } else if (frame.type === "folio.stream-failing") {
        depsRef.current.onFailing();
      } else {
        events.push(frame);
      }
    }, ctrl.signal);
    return ctrl.signal;
  }

  function noteStaleStep(frame: EventFrame) {
    if (frame.type !== "session.step.ended") return;
    const data = frame.data;
    const sessionID = typeof data?.sessionID === "string" ? data.sessionID : undefined;
    const aid = typeof data?.assistantMessageID === "string" ? data.assistantMessageID : undefined;
    if (sessionID && aid && Array.isArray(data?.files) && data.files.length) staleSteps.current.set(sessionID, aid);
  }

  /**
   * The user message that began the turn whose finished step made this
   * chapter's diff stale, as the chapter names it now (`local-…` until the
   * press names it); undefined when no such step was seen.
   */
  function staleTurn(chapter: Chapter): string | undefined {
    const aid = staleSteps.current.get(chapter.id);
    return aid ? chapter.turns?.[aid] : undefined;
  }

  function clearStaleTurn(chapterId: string) {
    staleSteps.current.delete(chapterId);
  }

  /** The stream has no replay; after an outage, set the chapters again from history. */
  async function resync(client: EngineClient, signal: AbortSignal) {
    const running = resyncRef.current;
    if (running && !running.signal.aborted) {
      running.again = true;
      return;
    }
    const run = { frames: [] as EventFrame[], again: false, signal };
    resyncRef.current = run;
    try {
      const snapshot = depsRef.current.bookRef.current;
      if (!snapshot || snapshot.sample) return;
      const fresh = withKeptPlates(await refreshBook(client, snapshot, { onNotice: (n) => depsRef.current.setNotice(n) }));
      if (signal.aborted) return;
      // Frames still waiting join the ones the merge applies again.
      if (abortRef.current?.signal === signal) queueRef.current?.flush();
      const frames = run.frames.slice();
      depsRef.current.setBook((current) =>
        current && !current.sample && current.id === fresh.id ? mergeResync(current, fresh, frames) : current,
      );
    } catch {
      // The next outage or turn will try again.
      if (!signal.aborted) depsRef.current.setNotice(RESYNC_FAILED);
    } finally {
      if (resyncRef.current === run) resyncRef.current = null;
      if (run.again && !signal.aborted) void resync(client, signal);
    }
  }

  return {
    listen,
    resync,
    stop,
    editBook,
    staleTurn,
    clearStaleTurn,
    isPaused: () => pausedRef.current,
  };
}
