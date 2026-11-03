// The parts of the claude.ai page runtime this app uses when it runs as a
// published Claude page (the web link). Elsewhere `window.claude` is absent
// and every getter resolves null.

export interface SampleError {
  code: string;
  message: string;
  text?: string;
}

export interface SampleOptions {
  onText?: (update: { text: string; delta: string }) => void;
  signal?: AbortSignal;
  images?: Blob[];
  modelTier?: "default" | "complex" | "quick";
  cache?: boolean | { gcTime?: number; refresh?: boolean };
}

export type SampleInput = string | { role: "user" | "assistant"; content: string }[];

export interface Sample {
  (input: SampleInput, options?: SampleOptions): Promise<{ text: string; truncated: boolean }>;
  json<T = unknown>(input: SampleInput, options?: SampleOptions): Promise<T>;
  limits(): Promise<{ images?: { maxCount: number } }>;
}

export interface McpError {
  code: string;
  message: string;
  server?: string;
  /** Set only when trying the same call again, unattended, may work. */
  retryable?: boolean;
  retryAfterMs?: number;
}

export interface Mcp {
  callTool(server: string, tool: string, input?: unknown): Promise<{ payload?: unknown }>;
}

export interface DocSnapshot {
  id: string;
  exists: boolean;
  data(): Record<string, unknown> | undefined;
}

export interface DocRef {
  id: string;
  get(): Promise<DocSnapshot>;
  set(data: Record<string, unknown>): Promise<void>;
  update(data: Record<string, unknown>): Promise<void>;
  delete(): Promise<void>;
  collection(path: string): CollectionRef;
}

export interface CollectionRef {
  doc(id?: string): DocRef;
  get(): Promise<{ docs: DocSnapshot[] }>;
}

export interface Db {
  doc(path: string): DocRef;
}

export interface UserCap {
  id(): Promise<string | null>;
  me(): Promise<{ name: string; email: string | null }>;
}

export interface Downloads {
  /** Asks the viewer to save a file; rejects (e.g. "declined") if they don't. */
  save(file: { filename: string; data: string | Blob }): Promise<unknown>;
}

/** "granted" | "prompt" | "denied" | "unavailable". Never rejects on a "no". */
export interface Permissions {
  state(name: string): Promise<string>;
  request(names: readonly string[]): Promise<Record<string, string>>;
}

/** The page's own comment writes; only the "send to Claude" part is used here. */
export interface Comments {
  /** "available" | "writers_only" | "no_session" | "off" (anything else: unavailable). */
  canSendToClaude(): Promise<string>;
  anchorFor(el: Element): Promise<unknown>;
  sendToClaude(target: { anchor: unknown; text: string }): Promise<{ threadId: string }>;
}

interface CapabilityMap {
  comments: Comments;
  downloads: Downloads;
  sample: Sample;
  mcp: Mcp;
  db: Db;
  user: UserCap;
  permissions: Permissions;
}

interface ClaudeRuntime {
  use<K extends keyof CapabilityMap>(name: K): Promise<CapabilityMap[K] | null>;
}

function runtime(): ClaudeRuntime | null {
  const w = window as unknown as { claude?: ClaudeRuntime };
  return typeof w.claude?.use === "function" ? w.claude : null;
}

export async function useCapability<K extends keyof CapabilityMap>(
  name: K,
): Promise<CapabilityMap[K] | null> {
  const claude = runtime();
  if (!claude) {
    return null;
  }
  try {
    const cap = await claude.use(name);
    if (name === "mcp" && cap) {
      // Every part of the app shares one wrapped connector namespace.
      shared ??= takeTurns(cap as Mcp);
      return shared as CapabilityMap[K];
    }
    return cap;
  } catch {
    return null;
  }
}

let shared: Mcp | null = null;

/** Connector tools that only read, so a call can safely be made twice. */
const READS = new Set([
  "search_threads",
  "get_thread",
  "list_events",
  "read_doc",
  "read_presentation",
  "get-create-design-async-job",
  "get_generation_status",
]);

const pause = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * The first call to each connector may ask the student to allow it, and
 * Claude can show only one such question at a time: when Today asked for
 * Gmail and Google Calendar together, one of them failed and Gmail stayed
 * "not connected". So first calls wait their turn, and a read that failed
 * for a reason that clears by itself (marked retryable) is tried once more.
 */
export function takeTurns(mcp: Mcp, wait: (ms: number) => Promise<void> = pause): Mcp {
  const settled = new Set<string>();
  let turn: Promise<unknown> = Promise.resolve();
  const call = async (server: string, tool: string, input?: unknown) => {
    try {
      return await mcp.callTool(server, tool, input);
    } catch (err) {
      const e = err as McpError | undefined;
      if (!e?.retryable || !READS.has(tool)) {
        throw err;
      }
      await wait(Math.min(Math.max(e.retryAfterMs ?? 1500, 500), 10_000));
      return mcp.callTool(server, tool, input);
    }
  };
  return {
    callTool(server, tool, input) {
      if (settled.has(server)) {
        return call(server, tool, input);
      }
      const run = turn.then(() => call(server, tool, input));
      const done = () => void settled.add(server);
      turn = run.then(done, done);
      return run;
    },
  };
}

export function isSampleError(err: unknown): err is SampleError {
  return typeof err === "object" && err !== null && typeof (err as SampleError).code === "string";
}
