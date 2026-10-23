// Minimal ElevenLabs Agents API client (fetch-based). Server-side only: it reads ELEVENLABS_API_KEY.
// No "server-only" import here because scripts/create-agent.ts also uses it from plain Node.
import { buildAgentRequest, type AgentOptions, type DynamicVariables } from "./agent-config";

// Override only for ElevenLabs EU data residency (https://api.eu.residency.elevenlabs.io).
function apiBase(): string {
  return (process.env.ELEVENLABS_API_BASE || "https://api.elevenlabs.io").replace(/\/+$/, "");
}

export class ElevenLabsError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
    this.name = "ElevenLabsError";
  }
}

function apiKey(): string {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new ElevenLabsError("ELEVENLABS_API_KEY is not set.", null);
  return key;
}

function describeErrorBody(body: string): string {
  try {
    const parsed = JSON.parse(body) as { detail?: unknown };
    const detail = parsed.detail;
    if (typeof detail === "string") return detail;
    if (detail && typeof detail === "object" && "message" in detail) {
      return String((detail as { message: unknown }).message);
    }
    if (Array.isArray(detail)) return JSON.stringify(detail).slice(0, 400);
  } catch {
    // Not JSON; fall through.
  }
  return body.slice(0, 400);
}

async function request<T>(path: string, init: { method?: string; body?: unknown; timeoutMs?: number } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiBase()}${path}`, {
      method: init.method ?? "GET",
      headers: { "xi-api-key": apiKey(), "content-type": "application/json", accept: "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(init.timeoutMs ?? 20_000),
      cache: "no-store",
    });
  } catch (error) {
    throw new ElevenLabsError(`Could not reach ElevenLabs: ${error instanceof Error ? error.message : String(error)}`, null);
  }
  const text = await response.text();
  if (!response.ok) {
    throw new ElevenLabsError(`ElevenLabs ${response.status}: ${describeErrorBody(text)}`, response.status);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

// ---------- Agents ----------

export async function createAgent(options: AgentOptions): Promise<string> {
  const result = await request<{ agent_id: string }>("/v1/convai/agents/create", {
    method: "POST",
    body: buildAgentRequest(options),
  });
  return result.agent_id;
}

export async function updateAgent(agentId: string, options: AgentOptions): Promise<void> {
  await request(`/v1/convai/agents/${encodeURIComponent(agentId)}`, {
    method: "PATCH",
    body: buildAgentRequest(options),
  });
}

// ---------- Workspace secrets ----------

type StoredSecret = { secret_id: string; name: string };

/** Creates or overwrites a workspace secret (found by ID first, then by exact name). Returns its ID. */
export async function upsertWorkspaceSecret(name: string, value: string, knownId: string | null): Promise<string> {
  let secretId = knownId;
  if (!secretId) {
    const { secrets } = await request<{ secrets: StoredSecret[] }>(`/v1/convai/secrets?search=${encodeURIComponent(name)}`);
    secretId = secrets.find((s) => s.name === name)?.secret_id ?? null;
  }
  if (secretId) {
    try {
      await request(`/v1/convai/secrets/${encodeURIComponent(secretId)}`, {
        method: "PATCH",
        body: { type: "update", name, value },
      });
      return secretId;
    } catch (error) {
      // Deleted in the ElevenLabs dashboard: fall through and create it again.
      if (!(error instanceof ElevenLabsError && error.status === 404)) throw error;
    }
  }
  const created = await request<StoredSecret>("/v1/convai/secrets", { method: "POST", body: { type: "new", name, value } });
  return created.secret_id;
}

// ---------- Phone numbers ----------

export type PhoneNumber = {
  phone_number_id: string;
  phone_number: string;
  label: string;
  provider: string;
  supports_outbound?: boolean;
};

export async function listPhoneNumbers(): Promise<PhoneNumber[]> {
  return request<PhoneNumber[]>("/v1/convai/phone-numbers");
}

// ---------- Calls ----------

export type OutboundCallResult = { conversationId: string; callSid: string | null };

export async function startTwilioOutboundCall(args: {
  agentId: string;
  agentPhoneNumberId: string;
  toNumber: string;
  dynamicVariables: DynamicVariables;
}): Promise<OutboundCallResult> {
  const result = await request<{ success: boolean; message: string; conversation_id?: string | null; callSid?: string | null }>(
    "/v1/convai/twilio/outbound-call",
    {
      method: "POST",
      timeoutMs: 30_000,
      body: {
        agent_id: args.agentId,
        agent_phone_number_id: args.agentPhoneNumberId,
        to_number: args.toNumber,
        conversation_initiation_client_data: { dynamic_variables: args.dynamicVariables },
      },
    },
  );
  if (!result.success || !result.conversation_id) {
    // The request was answered, so ElevenLabs did not place the call.
    throw new ElevenLabsError(`ElevenLabs could not start the call: ${result.message || "unknown reason"}`, 200);
  }
  return { conversationId: result.conversation_id, callSid: result.callSid ?? null };
}

export type ConversationStatus = "initiated" | "in-progress" | "processing" | "done" | "failed";

export type Conversation = {
  conversation_id: string;
  status: ConversationStatus;
  transcript: Array<{ role: "user" | "agent"; message?: string | null; time_in_call_secs: number }>;
  metadata: {
    start_time_unix_secs: number;
    call_duration_secs: number;
    termination_reason?: string | null;
    error?: { code?: number; reason?: string | null } | null;
  };
  analysis?: {
    data_collection_results?: Record<string, { value?: unknown; rationale?: string }>;
    call_successful?: "success" | "failure" | "unknown";
    transcript_summary?: string;
  } | null;
};

export async function getConversation(conversationId: string): Promise<Conversation> {
  return request<Conversation>(`/v1/convai/conversations/${encodeURIComponent(conversationId)}`, { timeoutMs: 10_000 });
}
