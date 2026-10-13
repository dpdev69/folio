/** Incremental SSE parser. Events are JSON objects in `data:` lines. */
export function pushSse(buffer: string, chunk: string): { events: unknown[]; rest: string } {
  const text = buffer + chunk;
  const frames = text.split(/\n\n/);
  const rest = frames.pop() ?? "";
  const events: unknown[] = [];
  for (const frame of frames) {
    const data = frame
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");
    if (!data || data === "[DONE]") continue;
    try {
      events.push(JSON.parse(data));
    } catch {
      // Ignore keepalives and partial comments.
    }
  }
  return { events, rest };
}

/** One event as the reducer reads it. */
export type EventFrame = {
  type?: string;
  data?: Record<string, unknown>;
  location?: Record<string, unknown>;
};

/**
 * opencode 2.0 frames are `{id, created?, type, location?, data, durable?}`;
 * this keeps the type, data and location, which is all the reducer reads.
 */
export function unwrapEvent(event: unknown): EventFrame {
  if (!isRecord(event)) return {};
  const type = typeof event.type === "string" ? event.type : undefined;
  const data = isRecord(event.data) ? event.data : undefined;
  const frame: EventFrame = { type };
  if (data) frame.data = data;
  if (isRecord(event.location)) frame.location = event.location;
  return frame;
}

/**
 * Calls `onSilent` once `ms` pass without a `poke`. The stream pokes it on
 * every chunk, heartbeat comments included, so only a dead stream trips it.
 */
export function watchdog(ms: number, onSilent: () => void): { poke: () => void; stop: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      onSilent();
    }, ms);
  };
  arm();
  return {
    poke: arm,
    stop: () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
}

/** Wait before reconnect `attempt` (1-based): 400 ms doubling to 8 s, give or take a fifth, never past 8 s. */
export function backoffDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(8000, 400 * 2 ** Math.max(0, attempt - 1));
  return Math.min(8000, Math.round(base * (0.8 + 0.4 * random())));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
