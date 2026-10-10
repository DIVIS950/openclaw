import {
  newId,
  todos,
  tutoring,
  type Tutor,
  type TutorMaterial,
  type TutorMessage,
  type TutorSession,
} from "./study.ts";
import { damagedLink, linkInbox, type PendingLink } from "./linkInbox.ts";
import { packJson, PAGES_URL, unpackJson } from "./transfer.ts";

// The student and their tutor swap links. Nothing goes through a server: the
// student sends the tutor a link that carries this tutor's lessons, materials
// and homework; the tutor opens it in the Tutor Hub, adds things, and sends a
// link back that the student's app reads and merges.

export const TUTOR_APP_URL = `${PAGES_URL}tutor.html`;
const TO_TUTOR = "#s=";
const FROM_TUTOR = "#tutor=";

export interface TutorHomework {
  id: string;
  text: string;
  /** YYYY-MM-DD or "". */
  due: string;
  done: boolean;
}

/** What the student sends the tutor. */
export interface TutorPacket {
  v: 1;
  kind: "to-tutor";
  student: string;
  /** For calendar invites; "" when the app doesn't know it. */
  studentEmail?: string;
  tutor: Tutor;
  sessions: TutorSession[];
  materials: Omit<TutorMaterial, "photo">[];
  homework: TutorHomework[];
  /** The conversation so far (both sides), newest last. */
  messages?: TutorMessage[];
  /** The student's mastery in this subject (0-100), when the Lab knows it. */
  mastery: number | null;
  nextTest: { topic: string; date: string } | null;
  /** The student's open school homework and tests in this subject (newer apps only). */
  school?: SchoolItem[];
  sentAt: string;
}

/** A piece of school work shown to the tutor (read-only). */
export interface SchoolItem {
  kind: "homework" | "test";
  title: string;
  /** YYYY-MM-DD or "". */
  due: string;
}

/** What the tutor sends back. */
export interface TutorReply {
  v: 1;
  kind: "from-tutor";
  tutorId: string;
  tutorName: string;
  sessions: TutorSession[];
  materials: Omit<TutorMaterial, "photo">[];
  homework: TutorHomework[];
  when: string;
  meet: string;
  message: string;
  /** Messages the tutor wrote (the one-line `message` is also kept for older apps). */
  messages?: TutorMessage[];
  sentAt: string;
}

export const fromLabel = (tutorName: string) => `Tutoring with ${tutorName}`;

/** The student's to-dos that came from this tutor. */
export function tutorHomework(tutor: Pick<Tutor, "name">): TutorHomework[] {
  return todos
    .all()
    .filter((t) => t.from === fromLabel(tutor.name))
    .map((t) => ({ id: t.id, text: t.text, due: t.due, done: t.done }));
}

export function buildPacket(
  tutor: Tutor,
  extras: {
    student: string;
    studentEmail?: string;
    mastery: number | null;
    nextTest: TutorPacket["nextTest"];
    school?: SchoolItem[];
  },
): TutorPacket {
  return {
    v: 1,
    kind: "to-tutor",
    student: extras.student,
    studentEmail: extras.studentEmail ?? "",
    tutor,
    sessions: tutoring.sessions().filter((s) => s.tutorId === tutor.id),
    materials: tutoring
      .materials()
      .filter((m) => m.tutorId === tutor.id)
      .map(({ photo: _photo, ...m }) => m),
    homework: tutorHomework(tutor),
    messages: tutoring
      .messages()
      .filter((m) => m.tutorId === tutor.id)
      .slice(-40),
    mastery: extras.mastery,
    nextTest: extras.nextTest,
    school: (extras.school ?? []).slice(0, 12),
    sentAt: new Date().toISOString(),
  };
}

export async function packetLink(packet: TutorPacket): Promise<string> {
  return `${TUTOR_APP_URL}${TO_TUTOR}${await packJson(packet)}`;
}

export async function replyLink(reply: TutorReply): Promise<string> {
  return `${PAGES_URL}${FROM_TUTOR}${await packJson(reply)}`;
}

// ---------- Checking what arrives in a link ----------
// Links can be cut short, edited or made by someone else, so nothing from one
// is trusted: every field is checked before it is saved or drawn.

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim() !== "";

function parseSession(v: unknown): TutorSession | null {
  if (!isObj(v) || !nonEmpty(v.id) || typeof v.topic !== "string") {
    return null;
  }
  return { id: v.id, tutorId: str(v.tutorId), date: str(v.date), topic: v.topic, notes: str(v.notes) };
}

function parseMaterial(v: unknown): TutorPacket["materials"][number] | null {
  if (!isObj(v) || !nonEmpty(v.id) || typeof v.title !== "string") {
    return null;
  }
  return { id: v.id, tutorId: str(v.tutorId), title: v.title, text: str(v.text), date: str(v.date) };
}

function parseHomework(v: unknown): TutorHomework | null {
  if (!isObj(v) || typeof v.text !== "string") {
    return null;
  }
  return { id: str(v.id), text: v.text, due: str(v.due), done: v.done === true };
}

function parseMessage(v: unknown): TutorMessage | null {
  if (
    !isObj(v) ||
    !nonEmpty(v.id) ||
    typeof v.text !== "string" ||
    (v.from !== "student" && v.from !== "tutor")
  ) {
    return null;
  }
  return { id: v.id, tutorId: str(v.tutorId), from: v.from, text: v.text, at: str(v.at) };
}

function parseSchool(v: unknown): SchoolItem | null {
  if (!isObj(v) || !nonEmpty(v.title) || (v.kind !== "homework" && v.kind !== "test")) {
    return null;
  }
  return { kind: v.kind, title: v.title, due: str(v.due) };
}

/**
 * A list from a link. Lenient: a missing list is [] and bad items are dropped.
 * Strict: a list that isn't a list, or any bad item, fails the whole thing (null).
 */
function listOf<T>(v: unknown, parse: (x: unknown) => T | null, strict: boolean): T[] | null {
  if (v === undefined || v === null) {
    return [];
  }
  if (!Array.isArray(v)) {
    return strict ? null : [];
  }
  const out = v.map(parse);
  if (strict && out.some((x) => x === null)) {
    return null;
  }
  return out.filter((x): x is T => x !== null);
}

/** A student's packet in a safe shape (missing lists become []), or null when it isn't one. */
export function normalizePacket(raw: unknown): TutorPacket | null {
  if (!isObj(raw) || raw.v !== 1 || raw.kind !== "to-tutor" || !isObj(raw.tutor)) {
    return null;
  }
  const t = raw.tutor;
  if (!nonEmpty(t.id)) {
    return null;
  }
  const next = isObj(raw.nextTest) ? raw.nextTest : null;
  return {
    v: 1,
    kind: "to-tutor",
    student: str(raw.student),
    studentEmail: str(raw.studentEmail),
    tutor: {
      id: t.id,
      name: str(t.name),
      subject: str(t.subject),
      meet: str(t.meet),
      whatsapp: str(t.whatsapp),
      when: str(t.when),
    },
    sessions: listOf(raw.sessions, parseSession, false) ?? [],
    materials: listOf(raw.materials, parseMaterial, false) ?? [],
    homework: listOf(raw.homework, parseHomework, false) ?? [],
    messages: listOf(raw.messages, parseMessage, false) ?? [],
    mastery:
      typeof raw.mastery === "number" && Number.isFinite(raw.mastery)
        ? Math.max(0, Math.min(100, Math.round(raw.mastery)))
        : null,
    nextTest: next && nonEmpty(next.date) ? { topic: str(next.topic), date: next.date } : null,
    school: listOf(raw.school, parseSchool, false) ?? [],
    sentAt: str(raw.sentAt),
  };
}

/** A tutor's reply, all or nothing: any damaged part rejects the whole reply. */
export function normalizeReply(raw: unknown): TutorReply | null {
  if (!isObj(raw) || raw.v !== 1 || raw.kind !== "from-tutor" || !nonEmpty(raw.tutorId)) {
    return null;
  }
  const sessions = listOf(raw.sessions, parseSession, true);
  const materials = listOf(raw.materials, parseMaterial, true);
  const homework = listOf(raw.homework, parseHomework, true);
  const messages = listOf(raw.messages, parseMessage, true);
  if (!sessions || !materials || !homework || !messages) {
    return null;
  }
  return {
    v: 1,
    kind: "from-tutor",
    tutorId: raw.tutorId,
    tutorName: str(raw.tutorName),
    sessions,
    materials,
    homework,
    when: str(raw.when),
    meet: str(raw.meet),
    message: str(raw.message),
    messages,
    sentAt: str(raw.sentAt),
  };
}

/** Lesson links the app will open: https Google Meet, Zoom or Teams only ("" otherwise). */
export function allowedMeet(url: string): string {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return "";
  }
  const host = u.hostname.toLowerCase();
  const ok =
    host === "meet.google.com" ||
    host === "zoom.us" ||
    host.endsWith(".zoom.us") ||
    host === "teams.microsoft.com" ||
    host === "teams.live.com";
  return u.protocol === "https:" && ok && !u.username && !u.password ? u.href : "";
}

/** In the Tutor Hub: the student's packet, null without one, "damaged" when it can't be read. */
export async function readPacketFromLocation(): Promise<TutorPacket | null | "damaged"> {
  const hash = window.location.hash;
  if (!hash.startsWith(TO_TUTOR)) {
    return null;
  }
  const p = normalizePacket(await unpackJson<unknown>(hash.slice(TO_TUTOR.length)));
  return p ?? "damaged";
}

export interface Applied {
  tutorName: string;
  sessions: number;
  materials: number;
  homework: number;
  message: string;
  messages: number;
}

/**
 * Merges a tutor's reply into the student's data; new things only, by id.
 * Only a tutor the student added can send things in, and only a Meet, Zoom or
 * Teams link replaces the lesson link. The student has already said yes in
 * LinkConfirm by the time this runs.
 */
export function applyReply(reply: TutorReply, today: string): Applied {
  const tutors = tutoring.tutors();
  const tutor = tutors.find((t) => t.id === reply.tutorId);
  if (!tutor) {
    return {
      tutorName: reply.tutorName,
      sessions: 0,
      materials: 0,
      homework: 0,
      message: "",
      messages: 0,
    };
  }
  const meet = allowedMeet(reply.meet);
  const when = reply.when.trim();
  if ((when && when !== tutor.when) || (meet && meet !== tutor.meet)) {
    tutoring.saveTutors(
      tutors.map((t) =>
        t.id === tutor.id ? { ...t, when: when || t.when, meet: meet || t.meet } : t,
      ),
    );
  }
  const name = tutor.name;
  const sessions = tutoring.sessions();
  const newSessions = reply.sessions.filter(
    (s) => s.tutorId === reply.tutorId && !sessions.some((x) => x.id === s.id),
  );
  if (newSessions.length > 0) {
    tutoring.saveSessions([...sessions, ...newSessions]);
  }
  const materials = tutoring.materials();
  const newMaterials = reply.materials
    .filter((m) => m.tutorId === reply.tutorId && !materials.some((x) => x.id === m.id))
    .map((m) => ({ ...m, photo: "" }));
  if (newMaterials.length > 0) {
    tutoring.saveMaterials([...materials, ...newMaterials]);
  }
  // The tutor's messages join the thread (older apps only sent the one line).
  const thread = tutoring.messages();
  const incoming: TutorMessage[] = (
    reply.messages?.length
      ? reply.messages
      : reply.message?.trim()
        ? [
            {
              id: `m-${reply.sentAt}`,
              tutorId: reply.tutorId,
              from: "tutor" as const,
              text: reply.message.trim(),
              at: reply.sentAt,
            },
          ]
        : []
  ).filter((m) => m.from === "tutor" && m.text.trim() && !thread.some((x) => x.id === m.id));
  if (incoming.length > 0) {
    tutoring.saveMessages(
      [...thread, ...incoming.map((m) => ({ ...m, tutorId: reply.tutorId }))].slice(-200),
    );
  }
  const list = todos.all();
  let homework = 0;
  for (const h of reply.homework) {
    const dupe = list.some(
      (t) => t.id === h.id || (t.from === fromLabel(name) && t.text === h.text && t.due === h.due),
    );
    if (!dupe && h.text.trim()) {
      list.push({
        id: h.id || newId("t"),
        text: h.text.trim(),
        due: h.due && h.due >= today ? h.due : h.due || "",
        done: false,
        subject: tutor.subject,
        from: fromLabel(name),
      });
      homework++;
    }
  }
  if (homework > 0) {
    todos.save(list);
  }
  return {
    tutorName: name,
    sessions: newSessions.length,
    materials: newMaterials.length,
    homework,
    message: reply.message ?? incoming[incoming.length - 1]?.text ?? "",
    messages: incoming.length,
  };
}

/** On the student's app: a reply in the address gets merged and the address cleaned. */
const shortLink = (url: string) => url.replace(/^https:\/\//, "").replace(/\/$/, "");

/** What a reply would bring in, line by line, for the student to OK first. */
export function replyPreview(reply: TutorReply, tutor: Tutor): string[] {
  const n = (count: number, one: string, many: string) =>
    count ? `${count} ${count === 1 ? one : many}` : "";
  const notes = tutoring.messages();
  const newMessages = (reply.messages?.length ? reply.messages : []).filter(
    (m) => m.from === "tutor" && m.text.trim() && !notes.some((x) => x.id === m.id),
  ).length;
  const lines = [
    n(reply.sessions.length, "lesson note", "lesson notes"),
    n(reply.materials.length, "material", "materials"),
    n(newMessages || (reply.message.trim() ? 1 : 0), "message", "messages"),
    ...reply.homework
      .filter((h) => h.text.trim())
      .slice(0, 4)
      .map((h) => `Homework: ${h.text.trim().slice(0, 80)}`),
  ].filter(Boolean);
  const when = reply.when.trim();
  if (when && when !== tutor.when) {
    lines.push(`New lesson time: ${when}`);
  }
  const meet = allowedMeet(reply.meet);
  if (meet && meet !== tutor.meet) {
    lines.push(`New lesson link: ${shortLink(meet)}`);
  } else if (reply.meet.trim() && !meet) {
    lines.push("A lesson link that isn't Google Meet, Zoom or Teams (it will be left out)");
  }
  return lines.length ? lines : ["Nothing new"];
}

/** Checks a reply: who it's from and what it brings, as something for LinkConfirm to show. */
export function checkReply(reply: TutorReply | null): PendingLink {
  if (!reply) {
    return damagedLink("your tutor");
  }
  const tutor = tutoring.tutors().find((t) => t.id === reply.tutorId);
  if (!tutor) {
    return {
      kind: "error",
      title: "This link isn't from one of your tutors",
      text: `It says it's from ${reply.tutorName.trim() || "a tutor"}, who isn't in your Tutoring. Nothing was brought in. If it's really your tutor, add them in Tutoring and share with them first.`,
    };
  }
  return {
    kind: "tutor",
    reply,
    title: `From ${tutor.name || "your tutor"}`,
    lines: replyPreview(reply, tutor),
  };
}

/**
 * On the student's app: a reply in the address is checked and the address
 * cleaned. Nothing is saved here: the reply (or why it was refused) waits in
 * linkInbox until the student says yes in LinkConfirm. Always resolves null;
 * the `today` argument stays for callers written before the confirm step.
 */
export async function importReplyFromLocation(_today?: string): Promise<Applied | null> {
  const hash = window.location.hash;
  if (!hash.startsWith(FROM_TUTOR)) {
    return null;
  }
  history.replaceState(null, "", window.location.pathname + window.location.search);
  const raw = await unpackJson<unknown>(hash.slice(FROM_TUTOR.length));
  linkInbox.set(checkReply(normalizeReply(raw)));
  return null;
}

/** Message for the toast after a reply came in. */
export function appliedSummary(a: Applied): string {
  const parts = [
    a.messages ? `${a.messages} ${a.messages === 1 ? "message" : "messages"}` : "",
    a.homework ? `${a.homework} homework` : "",
    a.sessions ? `${a.sessions} lesson ${a.sessions === 1 ? "note" : "notes"}` : "",
    a.materials ? `${a.materials} ${a.materials === 1 ? "material" : "materials"}` : "",
  ].filter(Boolean);
  const what = parts.length ? parts.join(", ") : "nothing new";
  return `From ${a.tutorName}: ${what}.${a.message ? ` "${a.message}"` : ""}`;
}

/**
 * A Google Calendar "new event" link, pre-filled: the tutor opens it, Google
 * adds a Meet link when the event has guests, and the student gets the invite.
 */
export function calendarInviteLink(opts: {
  title: string;
  start: Date;
  minutes: number;
  guest: string;
  details?: string;
}): string {
  const stamp = (d: Date) => d.toISOString().replace(/[-:]|\.\d{3}/g, "");
  const end = new Date(opts.start.getTime() + opts.minutes * 60_000);
  const q = new URLSearchParams({
    action: "TEMPLATE",
    text: opts.title,
    dates: `${stamp(opts.start)}/${stamp(end)}`,
    details: opts.details ?? "",
  });
  if (opts.guest) {
    q.set("add", opts.guest);
  }
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

/** The tutor's own copy, so the Tutor Hub remembers between visits. */
export const tutorStore = {
  key: (tutorId: string, student: string) => `tutorhub.${tutorId}.${student.toLowerCase()}`,
  get(tutorId: string, student: string): TutorPacket | null {
    try {
      return normalizePacket(
        JSON.parse(localStorage.getItem(tutorStore.key(tutorId, student)) ?? "null"),
      );
    } catch {
      return null;
    }
  },
  set(p: TutorPacket) {
    try {
      localStorage.setItem(tutorStore.key(p.tutor.id, p.student), JSON.stringify(p));
    } catch {
      // Not remembered.
    }
  },
  /** Every saved student; anything damaged (or another "tutorhub." setting) is skipped. */
  all(): TutorPacket[] {
    const out: TutorPacket[] = [];
    let keys: string[] = [];
    try {
      keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i) ?? "");
    } catch {
      return out;
    }
    for (const k of keys) {
      if (!k.startsWith("tutorhub.")) {
        continue;
      }
      try {
        const p = normalizePacket(JSON.parse(localStorage.getItem(k) ?? "null"));
        if (p) {
          out.push(p);
        }
      } catch {
        // Not a saved student.
      }
    }
    return out;
  },
};

/** What the tutor added in the Tutor Hub and hasn't sent yet. */
export interface TutorUnsent {
  sessions: TutorSession[];
  homework: TutorHomework[];
  materials: TutorPacket["materials"];
  messages: TutorMessage[];
  /** The lesson time and link as the tutor edited them; null when untouched. */
  when: string | null;
  meet: string | null;
  /** The short message typed in the send box. */
  message: string;
}

export const emptyUnsent = (): TutorUnsent => ({
  sessions: [],
  homework: [],
  materials: [],
  messages: [],
  when: null,
  meet: null,
  message: "",
});

/** True when something would be lost if the page closed now. */
export function hasUnsent(u: TutorUnsent, tutor: Pick<Tutor, "when" | "meet">): boolean {
  return (
    u.sessions.length + u.homework.length + u.materials.length + u.messages.length > 0 ||
    u.message.trim() !== "" ||
    (u.when !== null && u.when !== tutor.when) ||
    (u.meet !== null && u.meet !== tutor.meet)
  );
}

/**
 * The unsent pile, saved per student on every change so a reload, a closed
 * tab or an iPad dropping the page loses nothing. Cleared after "Make the link".
 * (Its own prefix, so tutorStore.all() never mistakes it for a student.)
 */
export const unsentStore = {
  key: (tutorId: string, student: string) =>
    `tutorhub-unsent.${tutorId}.${student.toLowerCase()}`,
  get(tutorId: string, student: string): TutorUnsent {
    let raw: unknown = null;
    try {
      raw = JSON.parse(localStorage.getItem(unsentStore.key(tutorId, student)) ?? "null");
    } catch {
      raw = null;
    }
    if (!isObj(raw)) {
      return emptyUnsent();
    }
    return {
      sessions: listOf(raw.sessions, parseSession, false) ?? [],
      homework: listOf(raw.homework, parseHomework, false) ?? [],
      materials: listOf(raw.materials, parseMaterial, false) ?? [],
      messages: listOf(raw.messages, parseMessage, false) ?? [],
      when: typeof raw.when === "string" ? raw.when : null,
      meet: typeof raw.meet === "string" ? raw.meet : null,
      message: str(raw.message),
    };
  },
  set(tutorId: string, student: string, u: TutorUnsent, tutor: Pick<Tutor, "when" | "meet">) {
    try {
      if (hasUnsent(u, tutor)) {
        localStorage.setItem(unsentStore.key(tutorId, student), JSON.stringify(u));
      } else {
        localStorage.removeItem(unsentStore.key(tutorId, student));
      }
    } catch {
      // Storage full or blocked: it stays on screen until sent.
    }
  },
  clear(tutorId: string, student: string) {
    try {
      localStorage.removeItem(unsentStore.key(tutorId, student));
    } catch {
      // Nothing saved.
    }
  },
};

/** Merges a fresh packet from the student into the tutor's saved copy (student data wins for done flags). */
export function mergePacket(saved: TutorPacket | null, fresh: TutorPacket): TutorPacket {
  if (!saved) {
    return fresh;
  }
  const byId = <T extends { id: string }>(a: T[], b: T[]) => {
    const ids = new Set(b.map((x) => x.id));
    return [...b, ...a.filter((x) => !ids.has(x.id))];
  };
  return {
    ...fresh,
    sessions: byId(saved.sessions, fresh.sessions),
    materials: byId(saved.materials, fresh.materials),
    homework: byId(saved.homework, fresh.homework),
    messages: byId(saved.messages ?? [], fresh.messages ?? []).toSorted((a, b) =>
      a.at.localeCompare(b.at),
    ),
  };
}
