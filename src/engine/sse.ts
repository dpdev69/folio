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

/** opencode 1.19 wraps each event as `{ payload: { type, properties } }`. Older frames are flat. */
export function unwrapEvent(event: unknown): { type?: string; properties?: Record<string, unknown> } {
  if (!event || typeof event !== "object") return {};
  const record = event as { type?: string; properties?: Record<string, unknown>; payload?: unknown };
  const payload = record.payload;
  if (payload && typeof payload === "object") {
    const inner = payload as { type?: string; properties?: Record<string, unknown> };
    if (typeof inner.type === "string") return { type: inner.type, properties: inner.properties ?? {} };
  }
  return { type: record.type, properties: record.properties };
}
