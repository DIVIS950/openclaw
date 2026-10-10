import { useEffect, useMemo, useState } from "react";
import { useApp } from "../context.ts";
import { agenda } from "../lib/agenda.ts";
import {
  aiSummary,
  allItems,
  buildDay,
  localSummary,
  type Day,
  type DayItem,
  type DaySummaryAi,
} from "../lib/daySummary.ts";
import { timetable } from "../lib/store.ts";
import { dayOf, prepPlan, prepTests, testHandoff, todos, tutoring } from "../lib/study.ts";
import { lessonLabel, upcomingTutoring } from "../lib/tutorSchedule.ts";
import type { Email } from "../lib/types.ts";
import { NoKeyError } from "../pages/gemini.ts";
import { Icon } from "./Icon.tsx";

// The AI briefing on Today: the app gathers the day, the AI (when it's there)
// picks what matters, written as one short paragraph (Bento "Daily brief").
// The chips under it open the things it names.

const CACHE = "psh.brief";

/** A word of the briefing: bold or not, and whether a space comes before it. */
interface Word {
  text: string;
  bold: boolean;
  space: boolean;
}

const fewWords = (text: string, n = 5) => {
  const words = text.split(/\s+/);
  return (words.length > n ? `${words.slice(0, n).join(" ")}…` : text).replace(/[,;:]$/, "");
};

/** "CAL: Summative test (…)" → subject "CAL", rest "Summative test (…)". */
const splitSubject = (text: string): { subject: string; rest: string } => {
  const m = text.match(/^([^:]{2,25}):\s*(.+)$/);
  return m ? { subject: m[1], rest: m[2] } : { subject: "", rest: text };
};

/** What to call an item in the briefing: tests become "Spanish prep". */
const itemName = (item: DayItem): string => {
  const { subject, rest } = splitSubject(item.text);
  if (item.kind === "test") {
    return subject ? `${subject} prep` : fewWords(rest, 3);
  }
  return fewWords(rest);
};

/** "Maths · due tomorrow" → "due tomorrow": the last part of a line is the reason. */
const reason = (sub: string) =>
  sub
    .split("·")
    .map((x) => x.trim())
    .filter(Boolean)
    .at(-1) ?? "";

/** The briefing as words: what to do first and why, then the tip or what's new. */
export function briefingWords(
  d: Day,
  s: DaySummaryAi,
  focus: { item: DayItem; why: string }[],
  smart: boolean,
): Word[] {
  const pieces: Piece[] = [];
  const say = (text: string, bold = false) => pieces.push({ text, bold });
  if (focus.length === 0) {
    say(s.headline || "Nothing urgent today. A good day to get ahead.");
  } else {
    focus.forEach((f, i) => {
      const minutes = f.item.sub.match(/(\d+)\s*min/)?.[1];
      const verb =
        f.item.kind === "homework"
          ? "hand in the "
          : f.item.kind === "test"
            ? `${minutes ?? "10"} minutes of `
            : "";
      const lead = i === 0 ? "" : i === focus.length - 1 ? ", and then " : ", then ";
      const phrase = `${lead}${verb}`;
      say(i === 0 ? phrase.charAt(0).toUpperCase() + phrase.slice(1) : phrase);
      say(itemName(f.item), true);
      const why = smart ? f.why : i === 0 ? reason(f.item.sub) : "";
      if (why) {
        say(` (${why.replace(/\.$/, "")})`);
      }
    });
    say(".");
    if (s.tip) {
      say(` ${s.tip.endsWith(".") ? s.tip : `${s.tip}.`}`);
    } else if (d.emails.length > 0) {
      say(` ${d.emails.length} new ${d.emails.length === 1 ? "email" : "emails"} in Inbox.`);
    } else if (d.next) {
      say(` Next: ${d.next}.`);
    }
  }
  // Split into words; punctuation glued to a piece stays on the word before it.
  const words: Word[] = [];
  let pending = false;
  for (const piece of pieces) {
    const parts = piece.text.split(" ");
    parts.forEach((part, k) => {
      if (!part) {
        // An empty part is a leading or trailing space.
        pending = true;
        return;
      }
      const space = words.length > 0 && (k > 0 || pending);
      words.push({ text: part, bold: Boolean(piece.bold), space });
      pending = false;
    });
    pending = pending || piece.text.endsWith(" ");
  }
  return words;
}

interface Piece {
  text: string;
  bold?: boolean;
}

export function Briefing() {
  const { ai, data, homework, profile, go, openAssignment } = useApp();
  const [emails, setEmails] = useState<Email[] | null>(null);
  const [smart, setSmart] = useState<DaySummaryAi | "nokey" | null>(null);
  const [at, setAt] = useState<Date | null>(null);
  const now = useMemo(() => new Date(), []);
  const today = dayOf(now);

  useEffect(() => {
    data.inbox().then(setEmails, () => setEmails([]));
  }, [data]);

  const day = useMemo(() => {
    const tests = prepTests.all();
    return buildDay({
      now,
      today,
      homework: homework ?? [],
      prep: tests.flatMap((test) => {
        const d = prepPlan(test, today).find((x) => x.date === today);
        return d && !test.done.includes(today) ? [{ test, day: d }] : [];
      }),
      tests,
      todos: todos.all(),
      events: agenda.all(),
      lessons: timetable.get(),
      emails: emails ?? [],
      tutoring: upcomingTutoring(tutoring.tutors(), now).map((u) => ({
        ...u,
        label: lessonLabel(u.start, now),
      })),
    });
  }, [homework, emails, now, today]);

  const key = `${today}|${now.getHours() < 12 ? "am" : now.getHours() < 17 ? "pm" : "eve"}|${allItems(
    day,
  )
    .map((x) => x.ref)
    .join(",")}`;

  const ready = homework !== null && emails !== null;
  useEffect(() => {
    if (!ai || !ready) {
      return;
    }
    try {
      const cached = JSON.parse(sessionStorage.getItem(CACHE) ?? "null") as {
        key: string;
        value: DaySummaryAi;
        at?: string;
      } | null;
      if (cached?.key === key) {
        setSmart(cached.value);
        setAt(cached.at ? new Date(cached.at) : now);
        return;
      }
    } catch {
      // Broken cache: ask again.
    }
    let live = true;
    aiSummary(ai, day, profile?.name ?? "", now).then(
      (value) => {
        if (live) {
          setSmart(value);
          setAt(new Date());
          if (!value) {
            return;
          }
          try {
            sessionStorage.setItem(
              CACHE,
              JSON.stringify({ key, value, at: new Date().toISOString() }),
            );
          } catch {
            // Not cached.
          }
        }
      },
      (err: unknown) => {
        if (live) {
          setSmart(err instanceof NoKeyError ? "nokey" : null);
        }
      },
    );
    return () => {
      live = false;
    };
  }, [key, ai, ready]);

  const open = (item: DayItem) => {
    switch (item.kind) {
      case "homework": {
        const hw = homework?.find((h) => h.id === item.id);
        if (hw) {
          openAssignment(hw);
        }
        break;
      }
      case "test":
        testHandoff.set(item.id);
        go("tests");
        break;
      case "todo":
        go("todo");
        break;
      case "event":
        go("timetable");
        break;
      case "email":
        go("inbox");
        break;
      case "tutor":
        go("tutoring");
        break;
    }
  };

  const summary = smart && smart !== "nokey" ? smart : localSummary(day);
  const byRef = new Map(allItems(day).map((x) => [x.ref, x]));
  const focus = summary.focus.flatMap((f) => {
    const item = byRef.get(f.ref);
    return item ? [{ item, why: f.why || item.sub }] : [];
  });
  const things = day.due.length + day.prep.length + day.todos.length;
  const words = briefingWords(day, summary, focus, Boolean(smart && smart !== "nokey"));
  const chips = focus.slice(0, 3);
  const updated = (at ?? now).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  return (
    <section className="card ai brief-card rise d2" aria-label="Daily brief">
      <div className="between" style={{ alignItems: "center" }}>
        <span className="chip violet">
          <Icon name="sparkle" size={14} />
          Daily brief
        </span>
        <span className="s12 muted">{updated}</span>
      </div>
      {homework === null ? (
        <div className="stack" style={{ gap: 8 }}>
          <div className="skeleton light" />
          <div className="skeleton light" style={{ width: "70%" }} />
        </div>
      ) : (
        <p className="brief" aria-label={things === 0 ? "Nothing urgent today" : undefined}>
          {words.map((x, k) => (
            <span key={k}>
              {x.space ? " " : ""}
              {x.bold ? <b>{x.text}</b> : x.text}
            </span>
          ))}
        </p>
      )}
      {chips.length > 0 && (
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          {chips.map((c, k) => (
            <button
              key={c.item.ref}
              className={`chip brief-chip${k === 0 ? " due" : ""}`}
              onClick={() => open(c.item)}
            >
              {shortLabel(c.item)}
            </button>
          ))}
        </div>
      )}
      {smart === "nokey" && (
        <button
          className="btn link s12"
          style={{ alignSelf: "flex-start", minHeight: 32, padding: 0 }}
          onClick={() => go("apps")}
        >
          Add the AI key for a smarter brief ›
        </button>
      )}
    </section>
  );
}

/** "Worksheet · 16:00": a few words of the item and its time or why. */
function shortLabel(item: DayItem): string {
  const head =
    itemName(item).split(/\s+/).length > 3 ? fewWords(itemName(item), 2) : itemName(item);
  const time = item.sub.match(/\b\d{1,2}:\d{2}\b/)?.[0];
  const minutes = item.kind === "test" ? item.sub.match(/\d+\s*min/)?.[0] : undefined;
  const when =
    minutes ??
    time ??
    (item.sub.includes("today") ? "today" : item.sub.includes("tomorrow") ? "tomorrow" : "");
  return when ? `${head} · ${when}` : head;
}
