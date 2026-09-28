import type { DataSource, Email, Homework } from "./types.ts";

// Classroom itself is blocked for outside apps at school, but Classroom emails
// every student ("New assignment: …", "Due tomorrow: …"). Those emails reach
// Gmail directly or through a phone automation that forwards them, and this
// turns them into homework, once each.

export const CLASSROOM_QUERY =
  'newer_than:30d ("Forwarded from Google Classroom" OR from:classroom.google.com)';

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
  const m =
    text.match(
      /\bdue:?\s+(?:[a-z]+,?\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,})\.?(?:,?\s+(\d{4}))?/i,
    ) ??
    text.match(
      /\bdue:?\s+(?:[a-z]+,?\s+)?([a-z]{3,})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/i,
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

/** "Mr Smith posted a new assignment in 9A Maths" → "9A Maths". */
export function parseCourse(text: string): string {
  const m = text.match(/\bposted a new \w+ in ([^.\n]{2,40}?)(?:\s*[.\n]|\s+due\b|$)/i);
  return m ? m[1].trim() : "";
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
  const title = m[2]
    .trim()
    .replace(/^["“'‘]+|["”'’]+$/g, "")
    .trim()
    .slice(0, 120);
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
    const task = parseClassroomEmail(email, now);
    const key = task?.title.toLowerCase();
    if (!task || !key || titles.has(key) || (task.due && task.due < today)) {
      continue;
    }
    titles.add(key);
    tasks.push(task);
  }
  return { tasks, ids };
}

/** Adds homework from new Classroom emails. Returns what was added. */
export async function syncClassroomEmails(
  data: DataSource,
  known: Homework[],
  now = new Date(),
): Promise<Homework[]> {
  if (data.demo || !data.searchEmails) {
    return [];
  }
  const emails = await data.searchEmails(CLASSROOM_QUERY);
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
  return added;
}
