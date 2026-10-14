/** Types for the replay press, so TypeScript tests can start it. */
export type ReplayRequest = { method?: string; path: string; query: Record<string, string>; body: unknown };

export type Replay = {
  url: string;
  requests: ReplayRequest[];
  streams: () => number;
  close: () => Promise<void>;
};

export function startReplay(options?: { port?: number; password?: string; flaky?: boolean; heartbeatMs?: number; pending?: boolean; files?: Record<string, string> }): Promise<Replay>;
