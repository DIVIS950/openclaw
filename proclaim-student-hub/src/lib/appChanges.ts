import { useCapability, type CollectionRef, type Comments } from "./claudeRuntime.ts";

// Change the app: the student writes what should change. On claude.ai the
// request is sent to Claude as a comment on this page (the Claude session that
// builds the app watches it), and kept in the page's database with a status
// Claude updates: queued → sent → building → live. A request that can't be
// sent right away waits as "queued" and is picked up at the hourly check.

export type RequestStatus = "queued" | "sent" | "building" | "live" | "declined";

export interface ChangeRequest {
  id: string;
  text: string;
  createdAt: string;
  status: RequestStatus;
  /** The version it went out in, when live. */
  version: string;
  /** Claude's short answer: what changed, or why not. */
  reply: string;
}

export const MAX_REQUEST = 1500;

const STATUSES = new Set<string>(["queued", "sent", "building", "live", "declined"]);

export interface ChangeLink {
  requests: CollectionRef;
  comments: Comments | null;
}

/** The request store and the comment link, or null where there's no database (website, demo). */
export async function connectChanges(): Promise<ChangeLink | null> {
  const [db, user, comments] = await Promise.all([
    useCapability("db"),
    useCapability("user"),
    useCapability("comments"),
  ]);
  const id = user ? await user.id().catch(() => null) : null;
  if (!db || !id) {
    return null;
  }
  return { requests: db.doc(`data/users/${id}/state`).collection("appRequests"), comments };
}

/** True when a request can go to Claude right now (an editor, with a Claude session watching). */
export async function canSendNow(link: ChangeLink): Promise<boolean> {
  if (!link.comments) {
    return false;
  }
  try {
    return (await link.comments.canSendToClaude()) === "available";
  } catch {
    return false;
  }
}

export function requestMessage(id: string, text: string): string {
  return [
    `Change request for the Student Hub app (request ${id}):`,
    "",
    text.trim().slice(0, MAX_REQUEST),
    "",
    "Please build it, test it and publish a new version.",
  ].join("\n");
}

/**
 * Sends a request: to Claude first (it has to follow the tap closely), then
 * saved. Returns the saved request; status "sent", or "queued" when it could
 * not be sent now.
 */
export async function sendRequest(
  link: ChangeLink,
  text: string,
  anchorEl: Element,
): Promise<ChangeRequest> {
  const ref = link.requests.doc();
  const request: ChangeRequest = {
    id: ref.id,
    text: text.trim().slice(0, MAX_REQUEST),
    createdAt: new Date().toISOString(),
    status: "queued",
    version: "",
    reply: "",
  };
  if (link.comments) {
    try {
      const anchor = await link.comments.anchorFor(anchorEl);
      await link.comments.sendToClaude({ anchor, text: requestMessage(request.id, request.text) });
      request.status = "sent";
    } catch {
      // Not sent (no session, not allowed, declined): it waits for the hourly check.
    }
  }
  await ref.set({ ...request });
  return request;
}

export async function listRequests(link: ChangeLink): Promise<ChangeRequest[]> {
  const snap = await link.requests.get();
  return snap.docs
    .map((d) => {
      const v = d.data() ?? {};
      const status = STATUSES.has(String(v.status))
        ? (v.status as RequestStatus)
        : "queued";
      return {
        id: d.id,
        text: typeof v.text === "string" ? v.text : "",
        createdAt: typeof v.createdAt === "string" ? v.createdAt : "",
        status,
        version: typeof v.version === "string" ? v.version : "",
        reply: typeof v.reply === "string" ? v.reply : "",
      };
    })
    .filter((r) => r.text)
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export const STATUS_LABEL: Record<RequestStatus, string> = {
  queued: "Waiting",
  sent: "Sent to Claude",
  building: "Building",
  live: "Live",
  declined: "Not done",
};

// ---------- "What's new" after an update ----------

const SEEN = "psh.seenVersion";

/** The version this device last ran, then remembers the current one. "" on a first run. */
export function lastSeenVersion(current: string): string {
  try {
    const seen = localStorage.getItem(SEEN) ?? "";
    if (seen !== current) {
      localStorage.setItem(SEEN, current);
    }
    return seen;
  } catch {
    return current;
  }
}
