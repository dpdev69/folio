/**
 * When Folio may ask the host for the press again. The first restart after a
 * steady stream goes at once; each one after it waits twice as long as the one
 * before (3 s, 6 s, 12 s … up to a minute), so a press that answers /api/info
 * but drops its stream is not started over every few seconds. A stream that
 * holds opens the gate again.
 */
export type RestartGate = { attempts: number; notBefore: number };

export const RESTART_FIRST_MS = 3000;
export const RESTART_CAP_MS = 60_000;

export function openGate(): RestartGate {
  return { attempts: 0, notBefore: 0 };
}

/** How long until a restart may begin; 0 means now. */
export function restartWait(gate: RestartGate, now: number): number {
  return Math.max(0, gate.notBefore - now);
}

/** The gate once a restart has begun at `now`, whatever it comes to. */
export function afterRestart(gate: RestartGate, now: number): RestartGate {
  const attempts = gate.attempts + 1;
  return { attempts, notBefore: now + Math.min(RESTART_CAP_MS, RESTART_FIRST_MS * 2 ** (attempts - 1)) };
}
