/**
 * When Folio may ask the host for the press again. The first restart after a
 * steady stream goes at once; each one after it waits twice as long as the one
 * before (3 s, 6 s, 12 s … up to a minute), so a press that answers /api/info
 * but drops its stream is not started over every few seconds. A stream that
 * holds opens the gate again, unless the press has been started over more than
 * RESTART_CHURN_COUNT times in RESTART_CHURN_WINDOW_MS: then a press that holds
 * its stream a moment and drops it each time still waits RESTART_CHURN_FLOOR_MS
 * between restarts.
 */
export type RestartGate = {
  attempts: number;
  notBefore: number;
  /** When each restart within the churn window began. */
  recent: number[];
};

export const RESTART_FIRST_MS = 3000;
export const RESTART_CAP_MS = 60_000;
export const RESTART_CHURN_COUNT = 5;
export const RESTART_CHURN_WINDOW_MS = 120_000;
export const RESTART_CHURN_FLOOR_MS = 10_000;

export function openGate(): RestartGate {
  return { attempts: 0, notBefore: 0, recent: [] };
}

/** How long until a restart may begin; 0 means now. */
export function restartWait(gate: RestartGate, now: number): number {
  return Math.max(0, gate.notBefore - now);
}

/** The gate once a restart has begun at `now`, whatever it comes to. */
export function afterRestart(gate: RestartGate, now: number): RestartGate {
  const attempts = gate.attempts + 1;
  const recent = [...within(gate.recent, now), now];
  const backoff = Math.min(RESTART_CAP_MS, RESTART_FIRST_MS * 2 ** (attempts - 1));
  const wait = recent.length > RESTART_CHURN_COUNT ? Math.max(backoff, RESTART_CHURN_FLOOR_MS) : backoff;
  return { attempts, notBefore: now + wait, recent };
}

/**
 * The gate once the stream has held at `now`: open again, except that a press
 * restarted more than RESTART_CHURN_COUNT times in the window may not be
 * restarted sooner than RESTART_CHURN_FLOOR_MS after the last restart began.
 */
export function steadyGate(gate: RestartGate, now: number): RestartGate {
  const recent = within(gate.recent, now);
  if (recent.length <= RESTART_CHURN_COUNT) return { attempts: 0, notBefore: 0, recent };
  return { attempts: 0, notBefore: recent[recent.length - 1] + RESTART_CHURN_FLOOR_MS, recent };
}

function within(times: number[], now: number): number[] {
  return times.filter((t) => now - t < RESTART_CHURN_WINDOW_MS);
}

/**
 * A count that moves on each time Folio sets out for a different press, so
 * work begun for an earlier press (a restart, an open) can tell, when it lands,
 * that it is no longer wanted.
 */
export type Generations = { next: () => number; current: () => number; isCurrent: (generation: number) => boolean };

export function generations(): Generations {
  let n = 0;
  return { next: () => ++n, current: () => n, isCurrent: (generation) => generation === n };
}
