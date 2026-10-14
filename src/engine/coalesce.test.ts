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

  it("hands over what is waiting at once on flush, and the scheduled run then finds nothing", () => {
    const frames = manualFrames();
    const flushes: string[][] = [];
    const queue = coalesce<string>((batch) => flushes.push(batch), frames.schedule);
    queue.push("a");
    queue.push("b");
    queue.flush();
    expect(flushes).toEqual([["a", "b"]]);
    frames.tick();
    expect(flushes).toEqual([["a", "b"]]);
    queue.flush();
    expect(flushes).toEqual([["a", "b"]]);
  });

  it("keeps a local change after the events that arrived before it", () => {
    const frames = manualFrames();
    const order: string[] = [];
    const queue = coalesce<string>((batch) => order.push(...batch), frames.schedule);
    queue.push("event 1");
    queue.push("event 2");
    queue.after(() => order.push("local"));
    queue.push("event 3");
    frames.tick();
    expect(order).toEqual(["event 1", "event 2", "local", "event 3"]);
  });
});
