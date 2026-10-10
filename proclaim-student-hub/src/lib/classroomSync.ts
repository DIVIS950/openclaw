import { dateInTitle, dayOf, newId, prepTests, sameTopic } from "./study.ts";
import type { DataSource, Email, Homework } from "./types.ts";

// Classroom itself is blocked for outside apps at school, but Classroom emails
// every student ("New assignment: …", "Due tomorrow: …"). Those emails reach
// Gmail directly or through a phone automation that forwards them, and this
// turns them into homework, once each.

// Direct Classroom emails, the phone automation's forwards, and ordinary
// forwards from the school account (their body names classroom.google.com).
// Anything that isn't a work notification is skipped by the subject check below.
export const CLASSROOM_QUERY =
  'newer_than:30d ("Forwarded from Google Classroom" OR from:classroom.google.com OR ' +
  '"Google Classroom" OR classroom.google.com OR from:parklane-is.com)';

const SEEN_KEY = "psh.classroom.seen";
const MAX_SEEN = 400;

/** Notification kinds that mean there is work to do. */
const WORK =
  /^(new assignment|new question|due tomorrow|due today|missing assignment|missing|reminder|work due)\b[^:]*:\s*(.+)$/i;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function day(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function plusDays(now: Date, n: number): string {
  const d = new Date(now);
  d.setDate(d.getDate() + n);
  return day(d);
}

/** Reads "Due 3 Oct", "Due: Oct 3, 2026" or "Due tomorrow" into YYYY-MM-DD, or "". */
export function parseDue(text: string, now: Date): string {
  if (/\bdue (today)\b/i.test(text)) {
    return day(now);
  }
  if (/\bdue tomorrow\b/i.test(text)) {
    return plusDays(now, 1);
  }
  // Only real month names count, so "Due Oct 9 See details" never reads "See" as a month.
  const MONTH = "((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*)";
  const m =
    text.match(
      new RegExp(
        `\\bdue:?\\s+(?:[a-z]+,?\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH}\\.?(?:,?\\s+(\\d{4}))?`,
        "i",
      ),
    ) ??
    text.match(
      new RegExp(
        `\\bdue:?\\s+(?:[a-z]+,?\\s+)?${MONTH}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`,
        "i",
      ),
    );
  if (!m) {
    return "";
  }
  const [dayPart, monthPart] = /^\d/.test(m[1]) ? [m[1], m[2]] : [m[2], m[1]];
  const month = MONTHS.indexOf(monthPart.slice(0, 3).toLowerCase());
  const date = Number(dayPart);
  if (month < 0 || date < 1 || date > 31) {
    return "";
  }
  let year = m[3] ? Number(m[3]) : now.getFullYear();
  // "Due 5 Jan" read in December is next year's January.
  if (
    !m[3] &&
    new Date(year, month, date) < new Date(now.getFullYear(), now.getMonth(), now.getDate() - 60)
  ) {
    year += 1;
  }
  return day(new Date(year, month, date));
}

export interface ClassroomTask {
  title: string;
  due: string;
  /** The class it was posted in, when the email says ("9A Maths"). */
  course: string;
}

/**
 * The class an email is about. Classroom's own emails start "Notification settings
 * <class> New assignment <title>…"; older forwards say "posted a new assignment in <class>".
 */
export function parseCourse(text: string): string {
  const direct = text.match(
    /Notification settings\s+(.{2,60}?)\s+(?:New (?:assignment|material|announcement|question)|Due (?:tomorrow|today)|Missing|Reminder)\b/i,
  );
  if (direct) {
    return direct[1].trim();
  }
  const m = text.match(/\bposted a new \w+ in ([^.\n]{2,40}?)(?:\s*[.\n]|\s+due\b|$)/i);
  return m ? m[1].trim() : "";
}

/** Gmail cuts long subjects ("…"); the snippet has the whole title. */
export function fullTitle(title: string, snippet: string): string {
  if (!/[…]$|\.\.\.$/.test(title)) {
    return title;
  }
  const stem = title.replace(/[…]$|\.\.\.$/, "").trim();
  const i = snippet.indexOf(stem);
  if (i < 0) {
    return stem;
  }
  const rest = snippet.slice(i);
  const end = rest.search(/\s+(?:Due\b|See details|View assignment|Posted on)/);
  return (end > 0 ? rest.slice(0, end) : rest).trim().slice(0, 120);
}

/** A material or announcement that is really about a test ("Test 6.10. - organizace výuky"). */
export function parseTestNotice(
  email: Pick<Email, "subject" | "snippet">,
  today: string,
): { topic: string; date: string; course: string } | null {
  let subject = email.subject.trim();
  while (/^(fwd?|fw):\s*/i.test(subject)) {
    subject = subject.replace(/^(fwd?|fw):\s*/i, "");
  }
  const m = subject.match(/^new (?:material|announcement):\s*(.+)$/i);
  if (!m) {
    return null;
  }
  const title = fullTitle(m[1].replace(/^["“'‘]+|["”'’]+$/g, "").trim(), email.snippet);
  if (!/\b(test|exam|assessment)\b|písemk|testu/i.test(title)) {
    return null;
  }
  const date = dateInTitle(title, today);
  return date ? { topic: title, date, course: parseCourse(email.snippet) } : null;
}

/** The homework in one Classroom email, or null for posts that aren't work (materials, comments, grades). */
export function parseClassroomEmail(
  email: Pick<Email, "subject" | "snippet">,
  now: Date,
): ClassroomTask | null {
  let subject = email.subject.trim();
  while (/^(fwd?|fw):\s*/i.test(subject)) {
    subject = subject.replace(/^(fwd?|fw):\s*/i, "");
  }
  const m = subject.match(WORK);
  if (!m) {
    return null;
  }
  const title = fullTitle(
    m[2]
      .trim()
      .replace(/^["“'‘]+|["”'’]+$/g, "")
      .trim(),
    email.snippet,
  ).slice(0, 120);
  if (!title) {
    return null;
  }
  return {
    title,
    due: parseDue(`${subject} ${email.snippet}`, now),
    course: parseCourse(email.snippet),
  };
}

function readSeen(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

function saveSeen(seen: Set<string>) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-MAX_SEEN)));
  } catch {
    // Not remembered: the title check below still stops duplicates.
  }
}

/** Picks the new tasks from a batch of emails; pure so it can be tested. */
export function newClassroomTasks(
  emails: Email[],
  known: Homework[],
  seen: Set<string>,
  now: Date,
): { tasks: ClassroomTask[]; ids: string[] } {
  const titles = new Set(known.map((h) => h.title.trim().toLowerCase()));
  const today = day(now);
  const tasks: ClassroomTask[] = [];
  const ids: string[] = [];
  // Oldest first, so a later "Due tomorrow" doesn't beat the "New assignment" it follows.
  for (const email of emails.toSorted((a, b) => a.date.localeCompare(b.date))) {
    if (seen.has(email.id)) {
      continue;
    }
    ids.push(email.id);
    // "Due tomorrow" means the day after the email was sent, not after the sync.
    const sent = email.date ? new Date(email.date) : now;
    const task = parseClassroomEmail(email, Number.isNaN(sent.getTime()) ? now : sent);
    const key = task?.title.toLowerCase();
    if (!task || !key || titles.has(key) || (task.due && task.due < today)) {
      continue;
    }
    titles.add(key);
    tasks.push(task);
  }
  return { tasks, ids };
}

export interface SyncStatus {
  /** ISO time of the last check. */
  at: string;
  checked: number;
  added: number;
  error: string;
}

const STATUS_KEY = "psh.sync.status";

export const syncStatus = {
  get(): SyncStatus | null {
    try {
      return JSON.parse(localStorage.getItem(STATUS_KEY) ?? "null") as SyncStatus | null;
    } catch {
      return null;
    }
  },
  set(s: SyncStatus) {
    try {
      localStorage.setItem(STATUS_KEY, JSON.stringify(s));
    } catch {
      // Not remembered.
    }
  },
};

/** Adds homework from new Classroom emails. Returns what was added. */
export async function syncClassroomEmails(
  data: DataSource,
  known: Homework[],
  now = new Date(),
): Promise<Homework[]> {
  if (data.demo || !data.searchEmails) {
    return [];
  }
  let emails: Email[];
  try {
    emails = await data.searchEmails(CLASSROOM_QUERY);
  } catch (err) {
    syncStatus.set({
      at: now.toISOString(),
      checked: 0,
      added: 0,
      error: err instanceof Error ? err.message : "Gmail couldn't be reached.",
    });
    throw err;
  }
  const seen = readSeen();
  const { tasks, ids } = newClassroomTasks(emails, known, seen, now);
  const added: Homework[] = [];
  try {
    for (const task of tasks) {
      added.push(
        await data.addHomework({
          title: task.title,
          source: "Classroom",
          due: task.due || undefined,
          course: task.course || undefined,
        }),
      );
    }
    for (const id of ids) {
      seen.add(id);
    }
  } finally {
    saveSeen(seen);
  }
  // Materials and announcements that announce a test go into the Tests screen.
  const today = dayOf(now);
  const tests = prepTests.all();
  const notices = emails
    .map((e) => parseTestNotice(e, today))
    .filter((t): t is NonNullable<typeof t> => t !== null && t.date >= today)
    .filter((t) => !tests.some((x) => x.date === t.date && sameTopic(x.topic, t.topic)));
  if (notices.length > 0) {
    prepTests.save([
      ...tests,
      ...notices.map((t) => ({
        id: newId("x"),
        subject: t.course || t.topic.split(/[:(]/)[0].trim(),
        topic: t.topic,
        date: t.date,
        start: today,
        packId: "",
        done: [],
      })),
    ]);
  }
  syncStatus.set({ at: now.toISOString(), checked: emails.length, added: added.length, error: "" });
  return added;
}
