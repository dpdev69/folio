import { afterEach, describe, expect, it, vi } from "vitest";
import { coalesce } from "./coalesce";

function manualFrames() {
  let pending: (() => void) | null = null;
  return {
    schedule: (run: () => void) => {
      pending = run;
      return () => {
        pending = null;
      };
    },
    tick: () => {
      const run = pending;
      pending = null;
      run?.();
    },
  };
}

describe("coalesce", () => {
  afterEach(() => vi.useRealTimers());

  it("turns many events in one frame into a single flush, in order", () => {
    const frames = manualFrames();
    const flushes: number[][] = [];
    const queue = coalesce<number>((batch) => flushes.push(batch), frames.schedule);
    for (let i = 0; i < 50; i++) queue.push(i);
    expect(flushes).toHaveLength(0);
    frames.tick();
    expect(flushes).toHaveLength(1);
    expect(flushes[0]).toEqual(Array.from({ length: 50 }, (_, i) => i));
    queue.push(50);
    frames.tick();
    expect(flushes).toEqual([flushes[0], [50]]);
  });

  it("drops what is waiting once cancelled", () => {
    const frames = manualFrames();
    const flush = vi.fn();
    const queue = coalesce<string>(flush, frames.schedule);
    queue.push("a");
    queue.cancel();
    frames.tick();
    expect(flush).not.toHaveBeenCalled();
  });

  it("falls back to a 16 ms timer where there are no animation frames", () => {
    vi.useFakeTimers();
    const flush = vi.fn();
    const queue = coalesce<string>(flush);
    queue.push("a");
    queue.push("b");
    vi.advanceTimersByTime(15);
    expect(flush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith(["a", "b"]);
  });
});
