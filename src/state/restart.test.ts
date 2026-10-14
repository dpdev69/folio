import { describe, expect, it } from "vitest";
import { afterRestart, openGate, RESTART_CAP_MS, restartWait } from "./restart";

describe("restarting the press", () => {
  it("goes at once the first time, then waits twice as long each time, up to a cap", () => {
    let gate = openGate();
    let now = 1_000;
    expect(restartWait(gate, now)).toBe(0);
    const waits: number[] = [];
    for (let i = 0; i < 7; i++) {
      gate = afterRestart(gate, now);
      waits.push(restartWait(gate, now));
      now += restartWait(gate, now);
      expect(restartWait(gate, now)).toBe(0);
    }
    expect(waits).toEqual([3000, 6000, 12000, 24000, 48000, RESTART_CAP_MS, RESTART_CAP_MS]);
  });

  it("counts down while waiting, and a steady stream opens the gate again", () => {
    const gate = afterRestart(afterRestart(openGate(), 0), 0);
    expect(restartWait(gate, 2000)).toBe(4000);
    expect(restartWait(openGate(), 2000)).toBe(0);
  });
});
