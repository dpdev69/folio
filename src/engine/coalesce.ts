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
 * so a burst of streamed deltas becomes one state update.
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
  return {
    push(item: T) {
      queue.push(item);
      if (!cancelScheduled) cancelScheduled = schedule(run);
    },
    cancel() {
      cancelScheduled?.();
      cancelScheduled = null;
      queue = [];
    },
  };
}
