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

interface CapabilityMap {
  sample: Sample;
  mcp: Mcp;
  db: Db;
  user: UserCap;
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
    return await claude.use(name);
  } catch {
    return null;
  }
}

export function isSampleError(err: unknown): err is SampleError {
  return typeof err === "object" && err !== null && typeof (err as SampleError).code === "string";
}
