import type { GoogleAuth } from "./googleAuth.ts";
import { SignInNeededError } from "./googleAuth.ts";
import { encodeReply, parseAddress } from "./mail.ts";
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

const CLASSROOM = "https://classroom.googleapis.com/v1";
const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";
const DRIVE = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const TASKS = "https://tasks.googleapis.com/tasks/v1/lists/@default/tasks";
const DOC_MIME = "application/vnd.google-apps.document";

export class GoogleApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// ---------- Google API response shapes (only the fields we use) ----------

interface Course {
  id: string;
  name: string;
}
interface GDate {
  year: number;
  month: number;
  day: number;
}
interface CourseWork {
  id: string;
  title: string;
  description?: string;
  dueDate?: GDate;
  dueTime?: { hours?: number; minutes?: number };
  alternateLink: string;
}
interface Submission {
  id: string;
  courseWorkId: string;
  state?: string;
}
interface Announcement {
  id: string;
  text?: string;
  updateTime: string;
  alternateLink: string;
}
interface GTask {
  id: string;
  title: string;
  notes?: string;
  due?: string;
  status: "needsAction" | "completed";
}
interface GmailMessage {
  id: string;
  threadId: string;
  snippet: string;
  labelIds?: string[];
  payload?: { headers?: { name: string; value: string }[] };
}
interface DriveFile {
  id: string;
  webViewLink?: string;
}

/** Classroom stores due dates as a UTC date plus optional UTC time. */
export function classroomDue(
  date?: GDate,
  time?: { hours?: number; minutes?: number },
): string | undefined {
  if (!date) {
    return undefined;
  }
  const hours = time?.hours ?? 23;
  const minutes = time?.minutes ?? 59;
  return new Date(Date.UTC(date.year, date.month - 1, date.day, hours, minutes)).toISOString();
}

// Tasks this app makes for other apps' homework carry "source:<app>" in their notes.
function taskSource(notes?: string): Source | null {
  const match = notes?.match(/^source:(.+)$/m);
  const name = match?.[1]?.trim();
  return OTHER_SOURCES.find((s) => s === name) ?? null;
}

function doneKey(id: string) {
  return `psh.done.${id}`;
}

export class GoogleData implements DataSource {
  readonly demo = false;
  readonly hasClassroom = true;
  readonly labels = {
    saved: "Saved to Google Docs",
    workNote: "Saved as a Google Doc in your Drive",
    workStep: "Work saved in your Google Doc",
    tickedStep: "Ticked off in your Google Tasks",
    added: "Added to your Google Tasks.",
    ticked: "Ticked off in Google Tasks.",
    homeworkSub: "Everything in one list, saved with Google.",
    addNote:
      "For apps like Dr Frost that can't share homework automatically. It goes into your Google Tasks.",
    sent: "Sent. It's in your Gmail Sent folder too.",
  };
  private coursesCache: Promise<Course[]> | null = null;
  private folderId: Promise<string> | null = null;

  constructor(private readonly auth: GoogleAuth) {}

  private async request<T>(url: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${this.auth.getToken()}`);
    const res = await fetch(url, { ...init, headers });
    if (res.status === 401) {
      throw new SignInNeededError();
    }
    if (!res.ok) {
      let message = `Google said no (${res.status}).`;
      try {
        const body = (await res.json()) as { error?: { message?: string } };
        message = body.error?.message ?? message;
      } catch {
        // Not JSON; keep the generic message.
      }
      throw new GoogleApiError(res.status, message);
    }
    if (res.status === 204) {
      return undefined as T;
    }
    const type = res.headers.get("content-type") ?? "";
    return (type.includes("json") ? await res.json() : await res.text()) as T;
  }

  private courses(): Promise<Course[]> {
    this.coursesCache ??= this.request<{ courses?: Course[] }>(
      `${CLASSROOM}/courses?studentId=me&courseStates=ACTIVE&pageSize=40`,
    ).then((r) => r.courses ?? []);
    this.coursesCache.catch(() => {
      this.coursesCache = null;
    });
    return this.coursesCache;
  }

  async profile(): Promise<Profile> {
    const me = await this.request<{ name?: string; given_name?: string; email: string }>(
      "https://www.googleapis.com/oauth2/v3/userinfo",
    );
    return { name: me.given_name || me.name || "", email: me.email };
  }

  async homework(): Promise<Homework[]> {
    const [classroom, tasks] = await Promise.all([this.classroomWork(), this.taskHomework()]);
    return [...classroom, ...tasks].toSorted((a, b) =>
      (a.due ?? "9999").localeCompare(b.due ?? "9999"),
    );
  }

  private async classroomWork(): Promise<Homework[]> {
    const courses = await this.courses();
    const recent = Date.now() - 14 * 24 * 3600 * 1000;
    const perCourse = await Promise.all(
      courses.map(async (course) => {
        try {
          const [work, subs] = await Promise.all([
            this.request<{ courseWork?: CourseWork[] }>(
              `${CLASSROOM}/courses/${course.id}/courseWork?pageSize=30&orderBy=${encodeURIComponent("dueDate desc")}`,
            ),
            this.request<{ studentSubmissions?: Submission[] }>(
              `${CLASSROOM}/courses/${course.id}/courseWork/-/studentSubmissions?userId=me&pageSize=100`,
            ),
          ]);
          const byWork = new Map((subs.studentSubmissions ?? []).map((s) => [s.courseWorkId, s]));
          return (work.courseWork ?? []).flatMap((cw): Homework[] => {
            const sub = byWork.get(cw.id);
            if (sub?.state === "TURNED_IN" || sub?.state === "RETURNED") {
              return [];
            }
            const due = classroomDue(cw.dueDate, cw.dueTime);
            if (due && Date.parse(due) < recent) {
              return [];
            }
            return [
              {
                id: cw.id,
                source: "Classroom",
                title: cw.title,
                course: course.name,
                description: cw.description ?? "",
                due,
                link: cw.alternateLink,
                done: localStorage.getItem(doneKey(cw.id)) === "1",
                courseId: course.id,
                submissionId: sub?.id,
              },
            ];
          });
        } catch (err) {
          // One class failing (e.g. no access) shouldn't hide the others.
          if (err instanceof SignInNeededError) {
            throw err;
          }
          return [];
        }
      }),
    );
    return perCourse.flat();
  }

  private async taskHomework(): Promise<Homework[]> {
    const res = await this.request<{ items?: GTask[] }>(
      `${TASKS}?showCompleted=false&maxResults=100`,
    );
    return (res.items ?? []).flatMap((t): Homework[] => {
      const source = taskSource(t.notes);
      if (!source) {
        return [];
      }
      return [
        {
          id: t.id,
          source,
          title: t.title,
          course: source,
          description: "",
          due: t.due,
          link: SOURCE_LINKS[source],
          done: t.status === "completed",
        },
      ];
    });
  }

  async addHomework(input: { title: string; source: Source; due?: string }): Promise<Homework> {
    const task = await this.request<GTask>(TASKS, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: input.title,
        notes: `source:${input.source}\nAdded from Proclaim Student Hub`,
        // Google Tasks only keeps the date part of "due".
        due: input.due ? new Date(`${input.due}T00:00:00Z`).toISOString() : undefined,
      }),
    });
    return {
      id: task.id,
      source: input.source,
      title: task.title,
      course: input.source,
      description: "",
      due: task.due,
      link: SOURCE_LINKS[input.source],
      done: false,
    };
  }

  async setDone(hw: Homework, done: boolean): Promise<void> {
    if (hw.source !== "Classroom") {
      await this.request(`${TASKS}/${hw.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          done ? { status: "completed" } : { status: "needsAction", completed: null },
        ),
      });
      return;
    }
    // Classroom work: keep a matching Google Task so "done" shows up in Google too.
    const mapKey = `psh.task.${hw.id}`;
    let taskId = localStorage.getItem(mapKey);
    if (!taskId) {
      const task = await this.request<GTask>(TASKS, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: `${hw.course}: ${hw.title}`,
          notes: `classroom:${hw.id}\n${hw.link}`,
          due: hw.due,
        }),
      });
      taskId = task.id;
      localStorage.setItem(mapKey, taskId);
    }
    await this.request(`${TASKS}/${taskId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        done ? { status: "completed" } : { status: "needsAction", completed: null },
      ),
    });
    localStorage.setItem(doneKey(hw.id), done ? "1" : "0");
  }

  // ---------- Drafts in Google Docs ----------

  private async findDraft(hw: Homework): Promise<DriveFile | null> {
    // drive.file only lets us see files this app created, which is exactly what we want.
    const q = `appProperties has { key='courseWorkId' and value='${hw.id.replace(/'/g, "")}' } and trashed = false`;
    const res = await this.request<{ files?: DriveFile[] }>(
      `${DRIVE}/files?q=${encodeURIComponent(q)}&fields=${encodeURIComponent("files(id,webViewLink)")}&pageSize=1`,
    );
    return res.files?.[0] ?? null;
  }

  async loadDraft(hw: Homework): Promise<Draft> {
    const file = await this.findDraft(hw);
    if (!file) {
      return { text: "", fileId: null, link: null };
    }
    // Export picks up edits made in Google Docs on any device.
    const text = await this.request<string>(`${DRIVE}/files/${file.id}/export?mimeType=text/plain`);
    return {
      text: text.replace(/^﻿/, "").replace(/\r\n/g, "\n"),
      fileId: file.id,
      link: file.webViewLink ?? null,
    };
  }

  private async appFolder(): Promise<string> {
    this.folderId ??= (async () => {
      const q =
        "appProperties has { key='app' and value='proclaim-student-hub' } and trashed = false";
      const found = await this.request<{ files?: DriveFile[] }>(
        `${DRIVE}/files?q=${encodeURIComponent(q)}&pageSize=1`,
      );
      if (found.files?.[0]) {
        return found.files[0].id;
      }
      const created = await this.request<DriveFile>(`${DRIVE}/files`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Proclaim Student Hub",
          mimeType: "application/vnd.google-apps.folder",
          appProperties: { app: "proclaim-student-hub" },
        }),
      });
      return created.id;
    })();
    this.folderId.catch(() => {
      this.folderId = null;
    });
    return this.folderId;
  }

  /** Creates a Google Doc from plain text (Drive converts it on upload). */
  private async createDoc(
    name: string,
    text: string,
    appProperties: Record<string, string>,
  ): Promise<DriveFile> {
    const boundary = `psh${Math.random().toString(36).slice(2)}`;
    const metadata = { name, mimeType: DOC_MIME, parents: [await this.appFolder()], appProperties };
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${text}\r\n--${boundary}--`;
    return this.request<DriveFile>(
      `${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id,webViewLink`,
      {
        method: "POST",
        headers: { "content-type": `multipart/related; boundary=${boundary}` },
        body,
      },
    );
  }

  async saveDraft(hw: Homework, text: string, fileId: string | null): Promise<Draft> {
    if (!fileId) {
      const me = await this.profile().catch(() => null);
      const file = await this.createDoc(`${hw.title}${me?.name ? ` - ${me.name}` : ""}`, text, {
        courseWorkId: hw.id,
        courseId: hw.courseId ?? "",
      });
      return { text, fileId: file.id, link: file.webViewLink ?? null };
    }
    const file = await this.request<DriveFile>(
      `${DRIVE_UPLOAD}/files/${fileId}?uploadType=media&fields=id,webViewLink`,
      {
        method: "PATCH",
        headers: { "content-type": "text/plain; charset=UTF-8" },
        body: text,
      },
    );
    return { text, fileId: file.id, link: file.webViewLink ?? null };
  }

  async handIn(hw: Homework, fileId: string | null): Promise<HandInResult> {
    await this.setDone(hw, true).catch(() => undefined);
    if (hw.source !== "Classroom" || !hw.courseId || !hw.submissionId) {
      return "openClassroom";
    }
    const base = `${CLASSROOM}/courses/${hw.courseId}/courseWork/${hw.id}/studentSubmissions/${hw.submissionId}`;
    try {
      if (fileId) {
        await this.request(`${base}:modifyAttachments`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ addAttachments: [{ driveFile: { id: fileId } }] }),
        });
      }
      await this.request(`${base}:turnIn`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      return "turnedIn";
    } catch (err) {
      // Google only lets the app that created an assignment turn it in, so
      // teacher-made work has to be finished in Classroom itself.
      if (err instanceof GoogleApiError && (err.status === 403 || err.status === 400)) {
        return "openClassroom";
      }
      throw err;
    }
  }

  async saveNotes(title: string, text: string): Promise<string> {
    const file = await this.createDoc(title, text, { kind: "revision" });
    return file.webViewLink ?? `https://docs.google.com/document/d/${file.id}/edit`;
  }

  // ---------- Inbox ----------

  async inbox(): Promise<Email[]> {
    const [mail, posts] = await Promise.all([this.gmail(), this.announcements()]);
    return [...mail, ...posts].toSorted((a, b) => b.date.localeCompare(a.date));
  }

  private async gmail(): Promise<Email[]> {
    const list = await this.request<{ messages?: { id: string }[] }>(
      `${GMAIL}/messages?maxResults=10&q=${encodeURIComponent("in:inbox category:primary")}`,
    );
    const headers = ["From", "Subject", "Date", "Message-ID"]
      .map((h) => `metadataHeaders=${h}`)
      .join("&");
    const messages = await Promise.all(
      (list.messages ?? []).map((m) =>
        this.request<GmailMessage>(`${GMAIL}/messages/${m.id}?format=metadata&${headers}`),
      ),
    );
    return messages.map((m) => {
      const header = (name: string) =>
        m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
      const from = parseAddress(header("From"));
      const date = Date.parse(header("Date"));
      return {
        id: m.id,
        kind: "Gmail" as const,
        threadId: m.threadId,
        from: from.name,
        fromEmail: from.email,
        subject: header("Subject") || "(no subject)",
        snippet: decodeEntities(m.snippet),
        date: Number.isNaN(date) ? new Date(0).toISOString() : new Date(date).toISOString(),
        unread: m.labelIds?.includes("UNREAD") ?? false,
        messageId: header("Message-ID"),
      };
    });
  }

  private async announcements(): Promise<Email[]> {
    const courses = await this.courses();
    const lists = await Promise.all(
      courses.slice(0, 12).map(async (course) => {
        try {
          const res = await this.request<{ announcements?: Announcement[] }>(
            `${CLASSROOM}/courses/${course.id}/announcements?pageSize=3`,
          );
          return (res.announcements ?? []).map((a) => {
            const text = (a.text ?? "").trim();
            return {
              id: `ann-${a.id}`,
              kind: "Classroom" as const,
              from: course.name,
              subject: text.split("\n")[0].slice(0, 90) || "New post",
              snippet: text.slice(0, 300),
              date: a.updateTime,
              unread: false,
              link: a.alternateLink,
            };
          });
        } catch (err) {
          if (err instanceof SignInNeededError) {
            throw err;
          }
          return [];
        }
      }),
    );
    return lists.flat();
  }

  async sendReply(email: Email, body: string): Promise<void> {
    if (email.kind !== "Gmail" || !email.fromEmail) {
      throw new Error("You can only reply to emails here.");
    }
    const me = await this.profile();
    await this.request(`${GMAIL}/messages/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        raw: encodeReply({
          from: me.email,
          to: email.fromEmail,
          subject: email.subject,
          body,
          inReplyTo: email.messageId,
        }),
        threadId: email.threadId,
      }),
    });
  }

  // ---------- Calendar ----------

  async events(): Promise<CalEvent[]> {
    const now = new Date();
    const until = new Date(now.getTime() + 36 * 3600 * 1000);
    const res = await this.request<{
      items?: {
        id: string;
        summary?: string;
        location?: string;
        start?: { dateTime?: string; date?: string };
      }[];
    }>(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?singleEvents=true&orderBy=startTime&maxResults=6` +
        `&timeMin=${encodeURIComponent(now.toISOString())}&timeMax=${encodeURIComponent(until.toISOString())}`,
    );
    return (res.items ?? []).map((e) => ({
      id: e.id,
      title: e.summary || "(no title)",
      start: e.start?.dateTime ?? e.start?.date ?? now.toISOString(),
      location: e.location,
    }));
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
