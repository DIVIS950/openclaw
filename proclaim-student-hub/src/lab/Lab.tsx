import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../components/Icon.tsx";
import { useAiContext, useApp } from "../context.ts";
import { useCapability } from "../lib/claudeRuntime.ts";
import { progress, schedule } from "../lib/store.ts";
import { labHandoff, labSubject, notes, packToNote, prepTests } from "../lib/study.ts";
import { subjectVars } from "../lib/subjects.ts";
import { GapFill, LabelDiagram, Match, OrderSteps } from "./Games.tsx";
import {
  dayString,
  daysUntil,
  isDue,
  isWeak,
  levelFor,
  mastery,
  review,
  shuffle,
  SUBJECTS,
  type LabPack,
  type ModeId,
  type Subject,
} from "./model.ts";
import { LearnList, MasteryDots, PackHome, Results } from "./Pack.tsx";
import { RevisionPlan } from "./Plan.tsx";
import { Scan } from "./Scan.tsx";
import { Session, type Entry, type Outcome } from "./Session.tsx";
import { canHear, daily, DAILY_GOAL, hearable } from "./speech.ts";
import {
  exportJson,
  importJson,
  labPacks,
  samplePack,
  settings,
  type LabSettings,
} from "./store.ts";

// Revision Lab: scan school work into packs, then practise them in eleven ways.
// Everything is stored on this device, so practice works offline.

type ItemMode = "flashcards" | "quiz" | "write" | "listen" | "review" | "speed" | "boss" | "mock";
type PlayMode = ModeId | "review";
const ITEM_MODES = new Set<PlayMode>([
  "flashcards",
  "quiz",
  "write",
  "listen",
  "review",
  "speed",
  "boss",
  "mock",
]);
const isItemMode = (mode: PlayMode): mode is ItemMode => ITEM_MODES.has(mode);

interface Play {
  name: "play";
  mode: PlayMode;
  entries: Entry[];
  packId: string | null;
  key: number;
}

type View =
  | { name: "home" | "library" | "weak" | "settings" | "scan" | "plan" }
  | { name: "pack" | "learn"; id: string }
  | Play
  | { name: "results"; outcome: Outcome; packId: string | null; replay: Play; xp: number };

const SESSION_SIZE: Partial<Record<PlayMode, number>> = {
  boss: 10,
  mock: 20,
  speed: 60,
  review: 20,
};

/** Weak, marked-wrong and due items first, then the rest, shuffled within each group. */
function pickEntries(packs: LabPack[], mode: PlayMode, today: string): Entry[] {
  const all = packs
    .flatMap((pack) => pack.items.map((item) => ({ pack, item })))
    .filter((e) => mode !== "listen" || hearable(e.item, e.pack.subject));
  const rank = (e: Entry) =>
    isWeak(e.item) || e.item.markedWrong ? 0 : isDue(e.item, today) ? 1 : 2;
  return shuffle(all, Date.now() % 10007)
    .toSorted((a, b) => rank(a) - rank(b))
    .slice(0, SESSION_SIZE[mode] ?? 15);
}

function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

function packAsText(pack: LabPack): string {
  return [
    `${pack.topic} (${pack.subject})`,
    ...(pack.insight ? ["", `The big fix: ${pack.insight}`] : []),
    "",
    ...pack.items.map((i) => `${i.prompt} = ${i.answer}`),
    "",
    "Made with Proclaim Student Hub · Revision Lab",
  ].join("\n");
}

export function Lab() {
  const app = useApp();
  const [packs, setPacks] = useState<LabPack[]>(labPacks.all);
  const [prefs, setPrefs] = useState<LabSettings>(settings.get);
  // Another screen (a test's prep plan, a note, tutoring) may have sent us here with a job.
  const [request] = useState(() => labHandoff.take());
  const scanRequest = request?.kind === "scan" ? request : null;
  const [view, setView] = useState<View>(() =>
    scanRequest
      ? { name: "scan" }
      : request?.kind === "open" && packs.some((p) => p.id === request.packId)
        ? { name: "pack", id: request.packId }
        : { name: "home" },
  );
  const online = useOnline();
  const today = dayString(new Date());
  const show = useCallback((next: View) => {
    setView(next);
    document.querySelector(".app")?.scrollTo?.(0, 0);
    window.scrollTo?.(0, 0);
  }, []);

  const save = useCallback(
    (next: LabPack[]) => {
      setPacks(next);
      if (!labPacks.saveAll(next)) {
        app.toast("This device is out of space, so your latest changes weren't saved.");
      }
    },
    [app],
  );

  const play = (mode: PlayMode, from: LabPack[], packId: string | null) => {
    if (mode === "learn" && packId) {
      show({ name: "learn", id: packId });
      return;
    }
    const entries = pickEntries(from, mode, today);
    if (isItemMode(mode) && entries.length === 0) {
      app.toast("Nothing to practise here yet.");
      return;
    }
    show({ name: "play", mode, entries, packId, key: Date.now() });
  };

  // Opened from a prep day: go straight into that day's practice.
  useEffect(() => {
    if (request?.kind !== "open" || !request.action || request.action === "material") {
      return;
    }
    const pack = packs.find((p) => p.id === request.packId);
    if (!pack) {
      return;
    }
    if (request.action === "weak") {
      const weak = pack.items.filter(isWeak);
      play("flashcards", [{ ...pack, items: weak.length ? weak : pack.items }], pack.id);
    } else {
      play(request.action, [pack], pack.id);
    }
    // Runs once, for the request this screen was opened with.
  }, [request]);

  const finish = (outcome: Outcome, replay: Play) => {
    // Only the first answer to each item moves it between boxes (speed rounds repeat items).
    const seen = new Set<string>();
    const verdicts = new Map<string, Outcome["answers"][number]["verdict"]>();
    for (const a of outcome.answers) {
      if (a.itemId && !seen.has(a.itemId)) {
        seen.add(a.itemId);
        verdicts.set(a.itemId, a.verdict);
      }
    }
    if (verdicts.size > 0) {
      save(
        packs.map((p) => ({
          ...p,
          items: p.items.map((i) => {
            const v = verdicts.get(i.id);
            return v ? review(i, v, today) : i;
          }),
        })),
      );
    }
    const xp = outcome.answers.reduce(
      (n, a) => n + (a.verdict === "correct" ? 2 : a.verdict === "almost" ? 1 : 0),
      0,
    );
    if (xp > 0) {
      progress.add(xp);
    }
    daily.add(today, verdicts.size);
    show({ name: "results", outcome, packId: replay.packId, replay, xp });
  };

  const packById = (id: string | null) => packs.find((p) => p.id === id) ?? null;
  const back = () => show({ name: "home" });

  switch (view.name) {
    case "scan":
      return (
        <Scan
          prefs={prefs}
          online={online}
          onBack={back}
          initial={
            scanRequest
              ? {
                  subject: labSubject(scanRequest.subject),
                  topic: scanRequest.topic,
                  text: scanRequest.text,
                  photos: scanRequest.photos,
                }
              : undefined
          }
          onSave={(pack) => {
            save([...packs, pack]);
            // Every pack also becomes a note (with its vocab list), and a test's pack is linked to the test.
            notes.upsert(packToNote(pack));
            if (scanRequest?.testId) {
              prepTests.save(
                prepTests
                  .all()
                  .map((t) => (t.id === scanRequest.testId ? { ...t, packId: pack.id } : t)),
              );
            }
            progress.add(10);
            app.toast("Pack saved. +10 XP");
            show({ name: "pack", id: pack.id });
            if (!app.data.demo) {
              app.data
                .saveNotes(`Revision: ${pack.topic}`, packAsText(pack))
                .catch(app.handleError);
            }
          }}
        />
      );
    case "plan":
      return <RevisionPlan topic="" onBack={back} />;
    case "library":
      return (
        <Library
          packs={packs}
          today={today}
          onBack={back}
          onOpen={(id) => show({ name: "pack", id })}
        />
      );
    case "weak":
      return (
        <WeakSpots
          packs={packs}
          onBack={back}
          onPlay={(mode) => {
            const weak = packs.map((p) => ({ ...p, items: p.items.filter(isWeak) }));
            play(mode, weak, null);
          }}
        />
      );
    case "settings":
      return (
        <Settings
          prefs={prefs}
          packs={packs}
          online={online}
          onBack={back}
          onPrefs={(next) => {
            setPrefs(next);
            settings.save(next);
          }}
          onPacks={save}
        />
      );
    case "pack":
    case "learn": {
      const pack = packById(view.id);
      if (!pack) {
        return (
          <LabHome
            packs={packs}
            today={today}
            online={online}
            go={show}
            onPlay={play}
            onSample={() => save([...packs, samplePack()])}
          />
        );
      }
      return view.name === "learn" ? (
        <LearnList pack={pack} onBack={() => show({ name: "pack", id: pack.id })} />
      ) : (
        <PackHome
          pack={pack}
          prefs={prefs}
          online={online}
          onBack={back}
          onPlay={(mode) => play(mode, [pack], pack.id)}
          onUpdate={(next) => save(packs.map((p) => (p.id === next.id ? next : p)))}
          onDelete={() => {
            save(packs.filter((p) => p.id !== pack.id));
            back();
          }}
        />
      );
    }
    case "play": {
      const pack = packById(view.packId);
      const quit = () => (pack ? show({ name: "pack", id: pack.id }) : back());
      const done = (outcome: Outcome) => finish(outcome, view);
      const props = { onDone: done, onQuit: quit };
      if (isItemMode(view.mode)) {
        return (
          <Session
            key={view.key}
            mode={view.mode}
            entries={view.entries}
            prefs={prefs}
            {...props}
          />
        );
      }
      if (!pack) {
        return null;
      }
      switch (view.mode) {
        case "match":
          return <Match key={view.key} pack={pack} {...props} />;
        case "gap":
          return <GapFill key={view.key} pack={pack} {...props} />;
        case "order":
          return <OrderSteps key={view.key} pack={pack} {...props} />;
        case "label":
          return <LabelDiagram key={view.key} pack={pack} {...props} />;
        default:
          return null;
      }
    }
    case "results": {
      const pack = packById(view.packId);
      const missedIds = new Set(
        view.outcome.answers
          .filter((a) => a.verdict !== "correct" && a.itemId)
          .map((a) => a.itemId),
      );
      const missed: Entry[] = packs.flatMap((p) =>
        p.items.filter((i) => missedIds.has(i.id)).map((item) => ({ pack: p, item })),
      );
      return (
        <Results
          outcome={view.outcome}
          pack={pack}
          xp={view.xp}
          onAgain={() => {
            // Rebuild from the saved packs so the replay sees the updated boxes.
            const from = pack ? [pack] : packs;
            const entries = isItemMode(view.replay.mode)
              ? view.replay.entries.map((e) => ({
                  pack: from.find((p) => p.id === e.pack.id) ?? e.pack,
                  item:
                    from.find((p) => p.id === e.pack.id)?.items.find((i) => i.id === e.item.id) ??
                    e.item,
                }))
              : [];
            show({ ...view.replay, entries, key: Date.now() });
          }}
          onMissed={
            missed.length
              ? () =>
                  show({
                    name: "play",
                    mode: "write",
                    entries: missed,
                    packId: view.packId,
                    key: Date.now(),
                  })
              : null
          }
          onBack={() => (pack ? show({ name: "pack", id: pack.id }) : back())}
        />
      );
    }
    default:
      return (
        <LabHome
          packs={packs}
          today={today}
          online={online}
          go={show}
          onPlay={play}
          onSample={() => save([...packs, samplePack()])}
        />
      );
  }
}

// ---------- Home ----------

function LabHome({
  packs,
  today,
  online,
  go,
  onPlay,
  onSample,
}: {
  packs: LabPack[];
  today: string;
  online: boolean;
  go: (view: View) => void;
  onPlay: (mode: PlayMode, from: LabPack[], packId: string | null) => void;
  onSample: () => void;
}) {
  const { go: appGo } = useApp();
  const stats = progress.get();
  const lvl = levelFor(stats.xp);
  const due = packs.reduce((n, p) => n + p.items.filter((i) => isDue(i, today)).length, 0);
  const weak = packs.reduce((n, p) => n + p.items.filter(isWeak).length, 0);
  const nextTest = schedule
    .get()
    .tests.map((t) => ({ ...t, days: daysUntil(t.date, today) }))
    .filter((t) => t.days >= 0)
    .toSorted((a, b) => a.days - b.days)[0];
  const subjects = SUBJECTS.flatMap((s) => {
    const items = packs.filter((p) => p.subject === s).flatMap((p) => p.items);
    return items.length ? [{ subject: s, mastery: mastery(items) }] : [];
  });
  useAiContext(
    `Revision Lab home. ${packs.length} packs; ${due} items due today; ${weak} weak spots. ` +
      `Subjects: ${subjects.map((s) => `${s.subject} ${s.mastery}%`).join(", ") || "none yet"}.` +
      (nextTest ? ` Next test: ${nextTest.topic} in ${nextTest.days} days.` : ""),
  );

  const done = daily.get(today).count;
  const goalPct = Math.min(100, Math.round((done / DAILY_GOAL) * 100));
  const reviewPool = (): LabPack[] => {
    // Due cards first; if none are due, the weakest ones so there's always something to do.
    const dueOnly = packs.map((p) => ({ ...p, items: p.items.filter((i) => isDue(i, today)) }));
    return due > 0 ? dueOnly : packs;
  };

  return (
    <main className="screen">
      <header className="between rise">
        <div className="stack" style={{ gap: 4 }}>
          <span className="eyebrow">Revision Lab</span>
          <h1 className="h1">Level {lvl.level}</h1>
        </div>
        <div className="row">
          <span className="chip warm" style={{ borderRadius: 16, padding: "6px 10px" }}>
            <Icon name="flame" size={16} className="wiggle" />
            {stats.streak} {stats.streak === 1 ? "day" : "days"}
          </span>
          <button
            className="round"
            aria-label="Lab settings"
            onClick={() => go({ name: "settings" })}
          >
            <Icon name="apps" size={18} />
          </button>
        </div>
      </header>
      <div className="stack" style={{ gap: 4 }}>
        <div className="bar" aria-label={`${lvl.into} of ${lvl.span} XP to level ${lvl.level + 1}`}>
          <div style={{ width: `${(lvl.into / lvl.span) * 100}%` }} />
        </div>
        <span className="muted" style={{ fontSize: 12 }}>
          {stats.xp} XP · {lvl.span - lvl.into} to level {lvl.level + 1}
        </span>
      </div>

      {!online && (
        <div className="banner">Offline: practice works; scanning needs the internet.</div>
      )}

      {packs.length === 0 ? (
        <>
          <button className="btn big primary rise" onClick={() => go({ name: "scan" })}>
            <Icon name="camera" size={20} />
            Scan a test or notes
          </button>
          <div className="card stack empty">
            <strong>No packs yet</strong>
            <span>
              Scan a marked test, class notes, a worksheet or a diagram. You'll get flashcards,
              quizzes and games made from it.
            </span>
            <button className="btn" onClick={onSample}>
              Try a sample pack
            </button>
          </div>
        </>
      ) : (
        <>
          <section className="card-dark stack rise daily" style={{ gap: 12 }}>
            <div className="row" style={{ gap: 16 }}>
              <div
                className="goal-ring"
                style={{ "--p": `${goalPct}%` } as React.CSSProperties}
                role="img"
                aria-label={`${done} of ${DAILY_GOAL} cards today`}
              >
                <span>
                  <strong>{done}</strong>/{DAILY_GOAL}
                </span>
              </div>
              <div className="stack" style={{ gap: 4, flex: 1 }}>
                <strong style={{ fontSize: 19 }}>
                  {done >= DAILY_GOAL ? "Daily goal done! 🎉" : "Review today"}
                </strong>
                <span style={{ opacity: 0.8, fontSize: 13 }}>
                  {due > 0
                    ? `${due} card${due === 1 ? "" : "s"} due. A 5-minute mix of quiz, typing${packs.some((p) => canHear(p)) ? ", listening" : ""} and flashcards.`
                    : "Nothing due: practise your weakest cards to stay sharp."}
                </span>
              </div>
            </div>
            <button
              className="btn primary big"
              onClick={() => onPlay("review", reviewPool(), null)}
            >
              <Icon name="flame" size={18} />
              {done >= DAILY_GOAL ? "Keep going" : "Start daily review"}
            </button>
          </section>

          <div className="lab-actions rise">
            <button
              className="quick-tile"
              aria-label="Scan a test or notes"
              onClick={() => go({ name: "scan" })}
            >
              <span className="quick-tile-icon" aria-hidden="true">
                <Icon name="camera" size={20} />
              </span>
              <strong>Scan</strong>
              <span>Test or notes</span>
            </button>
            <button
              className="quick-tile"
              aria-label={`${weak} weak spots`}
              onClick={() => go({ name: "weak" })}
            >
              <span className="quick-tile-icon" aria-hidden="true">
                <Icon name="flame" size={20} />
              </span>
              <strong>{weak} weak</strong>
              <span>Fix them</span>
            </button>
            <button
              className="quick-tile"
              aria-label={nextTest ? `Next test: ${nextTest.topic}` : "Tests"}
              onClick={() => appGo("tests")}
            >
              <span className="quick-tile-icon" aria-hidden="true">
                <Icon name="flag" size={20} />
              </span>
              <strong>
                {nextTest
                  ? nextTest.days === 0
                    ? "Test today"
                    : `${nextTest.days} day${nextTest.days === 1 ? "" : "s"}`
                  : "Tests"}
              </strong>
              <span className="clip">{nextTest ? nextTest.topic : "Add a date"}</span>
            </button>
          </div>

          {subjects.length > 0 && (
            <section className="stack rise" style={{ gap: 8 }}>
              <h2 className="h2">Mastery</h2>
              <div className="mastery-grid">
                {subjects.map((s) => (
                  <div key={s.subject} className="mastery-cell" style={subjectVars(s.subject)}>
                    <div
                      className="mini-ring"
                      style={{ "--p": `${s.mastery}%` } as React.CSSProperties}
                    >
                      {s.mastery}%
                    </div>
                    <span>{s.subject}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="stack">
            <div className="between">
              <h2 className="h2">Recent packs</h2>
              <button className="link-btn" onClick={() => go({ name: "library" })}>
                Library ›
              </button>
            </div>
            {packs
              .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
              .slice(0, 4)
              .map((p) => (
                <PackCard
                  key={p.id}
                  pack={p}
                  today={today}
                  onOpen={() => go({ name: "pack", id: p.id })}
                />
              ))}
          </section>
        </>
      )}
    </main>
  );
}

function PackCard({ pack, today, onOpen }: { pack: LabPack; today: string; onOpen: () => void }) {
  const due = pack.items.filter((i) => isDue(i, today)).length;
  const weak = pack.items.filter(isWeak).length;
  return (
    <button
      className="card stack pack-card subject-card rise"
      style={subjectVars(pack.subject)}
      onClick={onOpen}
    >
      <div className="between">
        <span className="eyebrow row" style={{ gap: 6 }}>
          <span className="subject-dot" /> {pack.subject}
        </span>
        <span className="muted" style={{ fontSize: 12 }}>
          {mastery(pack.items)}%
        </span>
      </div>
      <strong style={{ fontSize: 16 }}>{pack.topic}</strong>
      <MasteryDots pack={pack} />
      <span className="row" style={{ gap: 6, flexWrap: "wrap" }}>
        {due > 0 && <span className="chip good">{due} due</span>}
        {weak > 0 && <span className="chip warm">{weak} weak</span>}
        {pack.testScore && <span className="chip">Test {pack.testScore}</span>}
      </span>
    </button>
  );
}

// ---------- Library ----------

function Library({
  packs,
  today,
  onBack,
  onOpen,
}: {
  packs: LabPack[];
  today: string;
  onBack: () => void;
  onOpen: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [subject, setSubject] = useState<Subject | "All">("All");
  const [weakOnly, setWeakOnly] = useState(false);
  const subjects = SUBJECTS.filter((s) => packs.some((p) => p.subject === s));
  const q = query.trim().toLowerCase();
  const shown = packs
    .filter((p) => subject === "All" || p.subject === subject)
    .filter((p) => !weakOnly || p.items.some(isWeak))
    .filter(
      (p) =>
        !q ||
        p.topic.toLowerCase().includes(q) ||
        p.items.some(
          (i) => i.prompt.toLowerCase().includes(q) || i.answer.toLowerCase().includes(q),
        ),
    )
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
  useAiContext(`Revision Lab library: ${shown.map((p) => `${p.subject}: ${p.topic}`).join("; ")}`);

  return (
    <main className="screen">
      <header className="stack rise" style={{ gap: 4 }}>
        <button className="link-btn" style={{ alignSelf: "flex-start" }} onClick={onBack}>
          ‹ Revision Lab
        </button>
        <h1 className="h1">Library</h1>
      </header>
      <label htmlFor="lab-search" className="sr-only">
        Search packs
      </label>
      <input
        id="lab-search"
        className="field"
        type="search"
        placeholder="Search topics and words"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="pills" role="group" aria-label="Filter">
        {(["All", ...subjects] as const).map((s) => (
          <button
            key={s}
            className="pill"
            aria-pressed={subject === s}
            onClick={() => setSubject(s)}
          >
            {s}
          </button>
        ))}
        <button className="pill" aria-pressed={weakOnly} onClick={() => setWeakOnly(!weakOnly)}>
          Weak
        </button>
      </div>
      {shown.length === 0 ? (
        <div className="card empty">
          {packs.length ? "No packs match." : "No packs yet. Scan something first."}
        </div>
      ) : (
        <div className="stack">
          {shown.map((p) => (
            <PackCard key={p.id} pack={p} today={today} onOpen={() => onOpen(p.id)} />
          ))}
        </div>
      )}
    </main>
  );
}

// ---------- Weak spots ----------

function WeakSpots({
  packs,
  onBack,
  onPlay,
}: {
  packs: LabPack[];
  onBack: () => void;
  onPlay: (mode: ModeId) => void;
}) {
  const groups = packs
    .map((p) => ({ pack: p, items: p.items.filter(isWeak) }))
    .filter((g) => g.items.length > 0);
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  useAiContext(
    "Weak spots: " +
      groups
        .flatMap((g) => g.items.map((i) => `${i.prompt} = ${i.answer} (${g.pack.subject})`))
        .join("; "),
  );

  return (
    <main className="screen">
      <header className="stack rise" style={{ gap: 4 }}>
        <button className="link-btn" style={{ alignSelf: "flex-start" }} onClick={onBack}>
          ‹ Revision Lab
        </button>
        <h1 className="h1">Weak spots</h1>
        <p className="sub">Things you keep missing or got wrong on a test, from every pack.</p>
      </header>
      {total === 0 ? (
        <div className="card empty">No weak spots right now. Nice!</div>
      ) : (
        <>
          <div className="row">
            <button className="btn big primary" style={{ flex: 1 }} onClick={() => onPlay("write")}>
              Write them ({Math.min(total, 15)})
            </button>
            <button className="btn big" onClick={() => onPlay("flashcards")}>
              Flashcards
            </button>
          </div>
          {groups.map((g) => (
            <section key={g.pack.id} className="card stack">
              <div className="between">
                <strong>{g.pack.topic}</strong>
                <span className="eyebrow">{g.pack.subject}</span>
              </div>
              {g.items.map((i) => (
                <div key={i.id} className="between" style={{ gap: 12 }}>
                  <span>{i.prompt}</span>
                  <span className="muted" style={{ textAlign: "right" }}>
                    {i.answer}
                  </span>
                </div>
              ))}
            </section>
          ))}
        </>
      )}
    </main>
  );
}

// ---------- Settings ----------

/** Saves a file: through the claude.ai page runtime on the web link, else a normal download. */
async function saveFile(filename: string, data: string, toast: (m: string) => void) {
  const downloads = await useCapability("downloads");
  if (downloads) {
    await downloads.save({ filename, data }).catch((err: unknown) => {
      if ((err as { code?: string })?.code !== "declined") {
        toast("Couldn't save the file here. Use Copy instead.");
      }
    });
    return;
  }
  const url = URL.createObjectURL(new Blob([data], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function Settings({
  prefs,
  packs,
  online,
  onBack,
  onPrefs,
  onPacks,
}: {
  prefs: LabSettings;
  packs: LabPack[];
  online: boolean;
  onBack: () => void;
  onPrefs: (prefs: LabSettings) => void;
  onPacks: (packs: LabPack[]) => void;
}) {
  const { toast } = useApp();
  const file = useRef<HTMLInputElement>(null);
  const json = useMemo(() => exportJson(packs), [packs]);
  const items = packs.reduce((n, p) => n + p.items.length, 0);

  const doImport = async (f: File | undefined) => {
    if (!f) {
      return;
    }
    try {
      const { packs: next, added } = importJson(await f.text(), packs);
      onPacks(next);
      toast(`Imported ${added} ${added === 1 ? "pack" : "packs"}.`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Couldn't import that file.");
    }
  };

  return (
    <main className="screen">
      <header className="stack rise" style={{ gap: 4 }}>
        <button className="link-btn" style={{ alignSelf: "flex-start" }} onClick={onBack}>
          ‹ Revision Lab
        </button>
        <h1 className="h1">Lab settings</h1>
      </header>

      <section className="card stack">
        <label className="stack" style={{ gap: 6 }}>
          <span className="h2">Year / grade</span>
          <select
            className="field"
            value={prefs.grade}
            onChange={(e) => onPrefs({ ...prefs, grade: Number(e.target.value) })}
          >
            {[7, 8, 9, 10, 11, 12, 13].map((g) => (
              <option key={g} value={g}>
                Grade {g}
              </option>
            ))}
          </select>
        </label>
        <div className="stack" style={{ gap: 6 }}>
          <span className="h2">Explanations in</span>
          <div className="segmented" role="tablist" aria-label="Explanation language">
            {(["English", "Czech", "Spanish"] as const).map((l) => (
              <button
                key={l}
                role="tab"
                aria-selected={prefs.language === l}
                onClick={() => onPrefs({ ...prefs, language: l })}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="card stack">
        <h2 className="h2">Your packs</h2>
        <span className="muted">
          {packs.length} packs, {items} items, saved on this device. Export to keep a copy or move
          them to another phone.
        </span>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <button
            className="btn"
            disabled={packs.length === 0}
            onClick={() => void saveFile(`revision-lab-${dayString(new Date())}.json`, json, toast)}
          >
            Export file
          </button>
          <button
            className="btn"
            disabled={packs.length === 0}
            onClick={() =>
              navigator.clipboard.writeText(json).then(
                () => toast("Copied. Paste it into a note to keep it."),
                () => toast("Couldn't copy here. Use Export file."),
              )
            }
          >
            Copy
          </button>
          <button className="btn" onClick={() => file.current?.click()}>
            Import
          </button>
          <input
            ref={file}
            type="file"
            accept="application/json,.json,.txt"
            hidden
            onChange={(e) => {
              void doImport(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>
      </section>

      <section className="card stack">
        <h2 className="h2">Offline</h2>
        <div className="row">
          <span className={`chip${online ? " good" : " warm"}`}>
            {online ? "Online" : "Offline"}
          </span>
          <span className="muted">
            Practice, games and results work offline. Scanning and "Explain more" need the internet.
          </span>
        </div>
      </section>
    </main>
  );
}
