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
    case "not_granted":
      return new Error("Gmail isn't allowed for this page. Reload and allow it when asked.");
    case "blocked_by_policy":
    case "approval_required":
      return new Error("Your account's settings block Gmail on this page.");
    case "server_unavailable":
      return new Error("Gmail isn't answering right now. Try again in a minute.");
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
    const due = new Date(`${day}T16:00:00`).toISOString();
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
    const threads = ((payload as { threads?: GmailThread[] } | undefined)?.threads ?? []).filter(
      (t) => t.id && t.messages?.length,
    );
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
