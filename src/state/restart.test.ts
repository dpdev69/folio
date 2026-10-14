import { describe, expect, it } from "vitest";
import {
  afterRestart,
  generations,
  openGate,
  RESTART_CAP_MS,
  RESTART_CHURN_FLOOR_MS,
  RESTART_CHURN_WINDOW_MS,
  restartWait,
  steadyGate,
  type RestartGate,
} from "./restart";

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
    expect(restartWait(steadyGate(gate, 2000), 2000)).toBe(0);
  });

  it("keeps a press that holds a moment and drops each time at least ten seconds apart", () => {
    let gate: RestartGate = openGate();
    let now = 0;
    const waits: number[] = [];
    // Each cycle: restart, the stream holds 2 s, then drops 3 s later.
    for (let i = 0; i < 8; i++) {
      now += restartWait(gate, now);
      gate = afterRestart(gate, now);
      now += 2000;
      gate = steadyGate(gate, now);
      now += 3000;
      waits.push(restartWait(gate, now));
    }
    // The first five cycles restart at once; past five in two minutes, each waits out the floor.
    expect(waits.slice(0, 5)).toEqual([0, 0, 0, 0, 0]);
    expect(waits.slice(5)).toEqual([5000, 5000, 5000]);
    expect(gate.attempts).toBe(0);
  });

  it("lets the floor go once the restarts fall out of the two-minute window", () => {
    let gate: RestartGate = openGate();
    for (let i = 0; i < 6; i++) gate = afterRestart(steadyGate(gate, i * 1000), i * 1000);
    expect(restartWait(steadyGate(gate, 6000), 6000)).toBe(9000);
    const later = 5000 + RESTART_CHURN_WINDOW_MS;
    expect(restartWait(steadyGate(gate, later), later)).toBe(0);
    // While churning, even a restart from an open backoff waits the floor.
    expect(restartWait(afterRestart(steadyGate(gate, 6000), 6000), 6000)).toBe(RESTART_CHURN_FLOOR_MS);
  });
});

describe("press generations", () => {
  it("tells work begun for an earlier press that it is no longer wanted", () => {
    const gens = generations();
    const restart = gens.next();
    expect(gens.isCurrent(restart)).toBe(true);
    // preparePress sets out for another press while the restart is in flight.
    const prepare = gens.next();
    expect(gens.isCurrent(restart)).toBe(false);
    expect(gens.isCurrent(prepare)).toBe(true);
    expect(gens.current()).toBe(prepare);
  });
});
