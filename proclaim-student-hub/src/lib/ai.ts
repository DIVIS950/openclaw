import type {
  BriefRequest,
  BriefResponse,
  ChatTurn,
  InboxSummaryRequest,
  InboxSummaryResponse,
  ReviseRequest,
  TutorMode,
} from "../../shared/api.ts";
import type { RevisionPack } from "../../shared/pack.ts";

// Calls to our own server, which holds the Claude API key. The Google token
// proves the student is signed in.

export class AiError extends Error {}

async function post<T>(path: string, token: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new AiError(data.error ?? "The AI couldn't answer right now.");
  }
  return (await res.json()) as T;
}

export const ai = {
  brief: (token: string, req: BriefRequest) =>
    post<BriefResponse>("/api/ai/brief", token, req).then((r) => r.brief),
  inbox: (token: string, req: InboxSummaryRequest) =>
    post<InboxSummaryResponse>("/api/ai/inbox", token, req),
  revise: (token: string, req: ReviseRequest) => post<RevisionPack>("/api/ai/revise", token, req),

  /** Streams the tutor's answer; onText receives the full text so far. */
  async tutor(
    token: string,
    mode: TutorMode,
    history: ChatTurn[],
    onText: (soFar: string) => void,
    signal: AbortSignal,
  ): Promise<string> {
    const res = await fetch("/api/ai/tutor", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ mode, history }),
      signal,
    });
    if (!res.ok || !res.body) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new AiError(data.error ?? "Study Buddy couldn't answer right now.");
    }
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let text = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      text += value;
      onText(text);
    }
    return text;
  },
};
