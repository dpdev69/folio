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
  properties?: Record<string, unknown>;
};

/**
 * opencode 2.0 frames are `{id, created?, type, location?, data, durable?}`;
 * this keeps the type, data and location. Frames without `data` (opencode 1.x,
 * which the client still reads until it moves to 2.0) keep their properties.
 */
export function unwrapEvent(event: unknown): EventFrame {
  if (!isRecord(event)) return {};
  const type = typeof event.type === "string" ? event.type : undefined;
  if (isRecord(event.data)) {
    return isRecord(event.location) ? { type, data: event.data, location: event.location } : { type, data: event.data };
  }
  return { type, properties: isRecord(event.properties) ? event.properties : undefined };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
