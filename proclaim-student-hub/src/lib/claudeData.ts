import type { Db, DocRef, Mcp, McpError, UserCap } from "./claudeRuntime.ts";
import { parseAddress } from "./mail.ts";
import {
  OTHER_SOURCES,
  SOURCE_LINKS,
  type CalEvent,
  type DataSource,
  type Draft,
  type Email,
  type HandInResult,
  type Homework,
  type Profile,
  type Source,
} from "./types.ts";

// The web-link version, running as a published Claude page:
// - Gmail through the viewer's Gmail connector in claude.ai
// - homework and drafts in this page's own storage, private to each viewer
// Classroom, Drive and Calendar need the hosted version (or a connector).

const GMAIL = "Gmail";
const SOURCES: Source[] = ["Classroom", ...OTHER_SOURCES];

interface GmailMessage {
  id?: string;
  threadId?: string;
  date?: string;
  sender?: string;
  subject?: string;
  snippet?: string;
  labelIds?: string[];
  viewUrl?: string;
}

interface GmailThread {
  id?: string;
  messageCount?: number;
  messages?: GmailMessage[];
  viewUrl?: string;
}

function gmailError(err: unknown): Error {
  const code = (err as McpError | undefined)?.code;
  switch (code) {
    case "server_not_connected":
    case "server_not_found":
      return new Error("Add Gmail in claude.ai Settings → Connectors to see your email here.");
    case "needs_reauth":
      return new Error("Reconnect Gmail in claude.ai Settings → Connectors.");
    case "not_in_manifest":
      return new Error(
        "Gmail is turned off for Student Hub. Allow it in this app's Permissions in Claude, then tap Connect Gmail.",
      );
    case "blocked_by_policy":
    case "approval_required":
      return new Error("Your account's settings block Gmail on this page.");
    case "server_unavailable":
      return new Error("Gmail isn't answering right now. Try again in a minute.");
    case "selection_required":
      return new Error(
        "You have Gmail connected twice in Claude. Pick one when Claude asks, or remove one in Settings → Connectors.",
      );
    case "not_granted":
    case "capability_disabled":
    case "capability_removed":
      return new Error("Gmail can't be used in this view. Open Student Hub in the Claude app.");
    case "upstream_error":
      if ((err as McpError).retryable) {
        // Claude couldn't ask about Gmail just then (another question was open).
        return new Error("Claude couldn't ask about Gmail just then. Tap Connect Gmail again.");
      }
      return new Error((err as McpError).message || "Couldn't reach Gmail.");
    default:
      return new Error((err as McpError | undefined)?.message || "Couldn't reach Gmail.");
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function asSource(v: unknown): Source {
  return SOURCES.find((s) => s === v) ?? "Other";
}

export class ClaudeData implements DataSource {
  readonly demo = false;
  readonly hasClassroom = false;

  get gmailReachable(): boolean {
    return this.mcp !== null;
  }
  readonly labels = {
    saved: "Saved",
    workNote: "Saved in your Student Hub, only you can see it",
    workStep: "Work saved in your Student Hub",
    tickedStep: "Ticked off in your homework list",
    added: "Added to your homework list.",
    ticked: "Ticked off.",
    homeworkSub:
      "Your homework list, saved to your account. Add work from Classroom and your other apps.",
    addNote: "Copy the task from Classroom, Dr Frost or another app. It's saved to your account.",
    sent: "Sent. It's in your Gmail Sent folder too.",
  };

  private readonly root: DocRef | null;

  constructor(
    private readonly mcp: Mcp | null,
    db: Db | null,
    userId: string | null,
    private readonly user: UserCap | null,
  ) {
    // Each viewer's own subtree is private to them.
    this.root = db && userId ? db.doc(`data/users/${userId}/state`) : null;
  }

  private store(): DocRef {
    if (!this.root) {
      throw new Error("Saving isn't available on this page. Open it signed in to Claude.");
    }
    return this.root;
  }

  async profile(): Promise<Profile> {
    const me = await this.user?.me().catch(() => null);
    return { name: (me?.name ?? "").split(" ")[0] ?? "", email: me?.email ?? "" };
  }

  // ---------- Homework ----------

  async homework(): Promise<Homework[]> {
    if (!this.root) {
      return [];
    }
    const snap = await this.root.collection("homework").get();
    return snap.docs
      .flatMap((doc): Homework[] => {
        const d = doc.data();
        if (!d || typeof d.title !== "string") {
          return [];
        }
        const source = asSource(d.source);
        return [
          {
            id: doc.id,
            source,
            title: d.title,
            course: typeof d.course === "string" && d.course ? d.course : source,
            description: typeof d.description === "string" ? d.description : "",
            due: typeof d.due === "string" ? d.due : undefined,
            link: SOURCE_LINKS[source],
            done: d.done === true,
          },
        ];
      })
      .toSorted((a, b) => (a.due ?? "9999").localeCompare(b.due ?? "9999"));
  }

  async addHomework(input: {
    title: string;
    source: Source;
    due?: string;
    course?: string;
  }): Promise<Homework> {
    const ref = this.store().collection("homework").doc();
    const due = input.due ? new Date(`${input.due}T16:00:00`).toISOString() : undefined;
    await ref.set({
      title: input.title,
      source: input.source,
      course: input.course || input.source,
      ...(due ? { due } : {}),
      done: false,
      createdAt: new Date().toISOString(),
    });
    const id = ref.id;
    return {
      id,
      source: input.source,
      title: input.title,
      course: input.course || input.source,
      description: "",
      due,
      link: SOURCE_LINKS[input.source],
      done: false,
    };
  }

  async setDone(hw: Homework, done: boolean): Promise<void> {
    await this.store().collection("homework").doc(hw.id).update({ done });
  }

  async setDue(hw: Homework, day: string): Promise<string> {
    // An empty day clears the date.
    const due = day ? new Date(`${day}T16:00:00`).toISOString() : "";
    await this.store().collection("homework").doc(hw.id).update({ due });
    return due;
  }

  // ---------- Drafts ----------

  async loadDraft(hw: Homework): Promise<Draft> {
    if (!this.root) {
      return { text: "", fileId: null, link: null };
    }
    const snap = await this.root.collection("drafts").doc(hw.id).get();
    const text = snap.exists ? snap.data()?.text : undefined;
    return {
      text: typeof text === "string" ? text : "",
      fileId: snap.exists ? hw.id : null,
      link: null,
    };
  }

  async saveDraft(hw: Homework, text: string): Promise<Draft> {
    await this.store()
      .collection("drafts")
      .doc(hw.id)
      .set({ text, updatedAt: new Date().toISOString() });
    return { text, fileId: hw.id, link: null };
  }

  async handIn(hw: Homework): Promise<HandInResult> {
    await this.setDone(hw, true);
    return "openClassroom";
  }

  async saveNotes(): Promise<string> {
    // Revision packs are kept on this device; there's no Drive on the web link.
    return "";
  }

  // ---------- Gmail ----------

  async inbox(): Promise<Email[]> {
    return this.searchEmails("in:inbox category:primary", 12);
  }

  async searchEmails(query: string, pageSize = 20): Promise<Email[]> {
    if (!this.mcp) {
      return [];
    }
    let payload: unknown;
    try {
      ({ payload } = await this.mcp.callTool(GMAIL, "search_threads", { query, pageSize }));
    } catch (err) {
      throw gmailError(err);
    }
    const found = ((payload as { threads?: GmailThread[] } | undefined)?.threads ?? []).filter(
      (t) => t.id && t.messages?.length,
    );
    const threads = await Promise.all(found.map((t) => this.withDetails(t)));
    return threads.map((t) => {
      // Search previews carry the oldest messages; the first one names the thread.
      const first = t.messages?.[0] ?? {};
      const from = parseAddress(first.sender ?? "");
      const unread = (t.messages ?? []).some((m) => m.labelIds?.includes("UNREAD"));
      return {
        id: t.id ?? "",
        kind: "Gmail" as const,
        threadId: t.id,
        from: from.name,
        fromEmail: from.email,
        subject: first.subject || "(no subject)",
        snippet: decodeEntities(first.snippet ?? ""),
        date: first.date ?? new Date(0).toISOString(),
        unread,
        link: t.viewUrl,
      };
    });
  }

  /** Thread details already read, by thread id and message count. */
  private readonly details = new Map<string, GmailThread>();

  /**
   * Gmail's search previews stopped carrying the date, snippet and labels
   * (only sender and subject now). Without them a Classroom email has no
   * course or due date and the inbox shows 1970, so read the thread for them.
   * A thread that can't be read keeps its preview.
   */
  private async withDetails(t: GmailThread): Promise<GmailThread> {
    const first = t.messages?.[0];
    if (!this.mcp || !t.id || (first?.snippet && first.date)) {
      return t;
    }
    const key = `${t.id}:${t.messageCount ?? t.messages?.length ?? 0}`;
    let full = this.details.get(key);
    if (!full) {
      try {
        const { payload } = await this.mcp.callTool(GMAIL, "get_thread", {
          threadId: t.id,
          messageFormat: "MINIMAL",
        });
        full = (payload as GmailThread | undefined) ?? {};
      } catch {
        return t;
      }
      if (full.messages?.length) {
        this.details.set(key, full);
      }
    }
    return full.messages?.length ? { ...t, ...full, viewUrl: t.viewUrl ?? full.viewUrl } : t;
  }

  async sendReply(email: Email, body: string): Promise<void> {
    if (!this.mcp || !email.threadId) {
      throw new Error("You can only reply to emails here.");
    }
    let messageId: string | undefined;
    try {
      // Reply to the newest message so it lands in the right conversation.
      const { payload } = await this.mcp.callTool(GMAIL, "get_thread", {
        threadId: email.threadId,
        messageFormat: "METADATA_ONLY",
      });
      const messages = (payload as GmailThread | undefined)?.messages ?? [];
      messageId = messages[messages.length - 1]?.id;
    } catch (err) {
      throw gmailError(err);
    }
    if (!messageId) {
      throw new Error("Couldn't find that email to reply to.");
    }
    try {
      await this.mcp.callTool(GMAIL, "reply", { messageId, body });
    } catch (err) {
      // A failed send may still have gone out, so don't retry automatically.
      const e = gmailError(err);
      throw new Error(`${e.message} Check your Gmail Sent folder before trying again.`, {
        cause: err,
      });
    }
  }

  async events(): Promise<CalEvent[]> {
    return [];
  }
}
