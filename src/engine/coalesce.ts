/** Schedules `run` once and returns a way to call it off. */
export type Schedule = (run: () => void) => () => void;

/** The next animation frame, or 16 ms where there are no frames (tests, workers). */
export const nextFrame: Schedule = (run) => {
  if (typeof requestAnimationFrame === "function") {
    const id = requestAnimationFrame(() => run());
    return () => cancelAnimationFrame(id);
  }
  const id = setTimeout(run, 16);
  return () => clearTimeout(id);
};

/**
 * Gather items as they arrive and hand them over once per frame, in order,
 * so a burst of streamed deltas becomes one state update. `flush` hands over
 * what is waiting at once: a local change to the same state drains the queue
 * first, so it never lands ahead of events that arrived before it.
 */
export function coalesce<T>(flush: (batch: T[]) => void, schedule: Schedule = nextFrame) {
  let queue: T[] = [];
  let cancelScheduled: (() => void) | null = null;
  const run = () => {
    cancelScheduled = null;
    const batch = queue;
    queue = [];
    if (batch.length) flush(batch);
  };
  const flushNow = () => {
    cancelScheduled?.();
    cancelScheduled = null;
    run();
  };
  return {
    push(item: T) {
      queue.push(item);
      if (!cancelScheduled) cancelScheduled = schedule(run);
    },
    /** Hand over what is waiting now, in order; the scheduled run then finds nothing. */
    flush: flushNow,
    /**
     * Drain the queue, then run `local`, so a local change keeps its place
     * after the events that arrived before it.
     */
    after(local: () => void) {
      flushNow();
      local();
    },
    cancel() {
      cancelScheduled?.();
      cancelScheduled = null;
      queue = [];
    },
  };
}
