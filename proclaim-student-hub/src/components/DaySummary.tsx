import { useEffect, useMemo, useState } from "react";
import { useApp } from "../context.ts";
import { agenda } from "../lib/agenda.ts";
import {
  aiSummary,
  allItems,
  buildDay,
  localSummary,
  type DayItem,
  type DaySummaryAi,
} from "../lib/daySummary.ts";
import { timetable } from "../lib/store.ts";
import { dayOf, prepPlan, prepTests, testHandoff, todos, tutoring } from "../lib/study.ts";
import { lessonLabel, upcomingTutoring } from "../lib/tutorSchedule.ts";
import type { Email } from "../lib/types.ts";
import { NoKeyError } from "../pages/gemini.ts";
import { Icon, type IconName } from "./Icon.tsx";

// "Your day": what's on now, what to do first (the AI decides and says why),
// test prep, to-dos, what's coming and new emails. Every line opens its thing.

const CACHE = "psh.brief";

const ICON: Record<DayItem["kind"], IconName> = {
  homework: "homework",
  test: "flag",
  todo: "todo",
  event: "calendar",
  email: "mail",
  tutor: "book",
};

export function DaySummary() {
  const { ai, data, homework, profile, go, openAssignment } = useApp();
  const [emails, setEmails] = useState<Email[] | null>(null);
  const [smart, setSmart] = useState<DaySummaryAi | "nokey" | null>(null);
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

  // Ask once homework and email have both loaded (they may not change the key).
  const ready = homework !== null && emails !== null;
  useEffect(() => {
    if (!ai || !ready) {
      return;
    }
    try {
      const cached = JSON.parse(sessionStorage.getItem(CACHE) ?? "null") as {
        key: string;
        value: DaySummaryAi;
      } | null;
      if (cached?.key === key) {
        setSmart(cached.value);
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
          if (!value) {
            return;
          }
          try {
            sessionStorage.setItem(CACHE, JSON.stringify({ key, value }));
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
  const shown = new Set(focus.map((f) => f.item.ref));
  const rest = (list: DayItem[]) => list.filter((x) => !shown.has(x.ref));

  const row = (item: DayItem, why?: string, n?: number) => (
    <button key={item.ref} className="day-row" onClick={() => open(item)}>
      <span className={n ? "day-num" : "day-icon"} aria-hidden="true">
        {n ?? <Icon name={ICON[item.kind]} size={14} />}
      </span>
      <span className="day-text">
        <strong>{item.text}</strong>
        <span>{why ?? item.sub}</span>
      </span>
      <span aria-hidden="true" className="day-go">
        ›
      </span>
    </button>
  );

  const section = (title: string, list: DayItem[]) =>
    list.length > 0 && (
      <div className="day-section">
        <div className="day-label">{title}</div>
        {list.map((x) => row(x))}
      </div>
    );

  return (
    <div className="stack" style={{ gap: 12 }}>
      {(day.now || day.next) && (
        <button className="day-now" onClick={() => go("timetable")}>
          <Icon name="calendar" size={14} />
          {day.now ? `Now: ${day.now}` : ""}
          {day.now && day.next ? " · " : ""}
          {day.next ? `Next: ${day.next}` : ""}
        </button>
      )}
      {homework === null ? (
        <div className="stack" style={{ gap: 8 }} aria-label="Loading summary">
          <div className="skeleton" />
          <div className="skeleton" style={{ width: "70%" }} />
        </div>
      ) : (
        <p className="pop day-headline">{summary.headline}</p>
      )}
      {smart === "nokey" && (
        <button
          className="link-btn"
          style={{ color: "var(--accent)", alignSelf: "flex-start" }}
          onClick={() => go("apps")}
        >
          Set up the AI for smarter tips ›
        </button>
      )}
      {focus.length > 0 && (
        <div className="day-section">
          <div className="day-label">Do first</div>
          {focus.map((f, i) => row(f.item, f.why, i + 1))}
        </div>
      )}
      {section("Due soon", rest(day.due))}
      {section("Test prep today", rest(day.prep))}
      {section("To-do", rest(day.todos))}
      {section("Coming up", rest(day.coming))}
      {section("New emails", rest(day.emails))}
      {summary.tip && <p className="day-tip">💡 {summary.tip}</p>}
      {homework && allItems(day).length === 0 && !day.now && (
        <p className="day-tip">Tap + at the top to add homework, tests or plans.</p>
      )}
    </div>
  );
}
