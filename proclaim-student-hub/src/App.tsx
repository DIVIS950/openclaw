import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppConfig, ImageInput, TutorMode } from "../shared/api.ts";
import { AddAnythingButton } from "./components/AddAnything.tsx";
import { AskAi } from "./components/AskAi.tsx";
import { Confetti } from "./components/Confetti.tsx";
import { Icon } from "./components/Icon.tsx";
import { LinkConfirm } from "./components/LinkConfirm.tsx";
import { Tour, tour } from "./components/Tour.tsx";
import {
  Ctx,
  SCREENS,
  type AppContext,
  type Screen,
  type ToastAction,
  type TutorSeed,
} from "./context.ts";
import { sampleAi, serverAi, type AiProvider } from "./lib/ai.ts";
import { syncClassroomEmails } from "./lib/classroomSync.ts";
import { ClaudeData } from "./lib/claudeData.ts";
import { useCapability } from "./lib/claudeRuntime.ts";
import { DemoData } from "./lib/demoData.ts";
import { GoogleAuth, SignInNeededError } from "./lib/googleAuth.ts";
import { GoogleData } from "./lib/googleData.ts";
import { damagedLink, linkInbox } from "./lib/linkInbox.ts";
import { dueReminders, newHomeworkReminder, notifyPrefs, show } from "./lib/notify.ts";
import { applyHomeworkSeed } from "./lib/seed.ts";
import { timetable } from "./lib/store.ts";
import { tutoring } from "./lib/study.ts";
import { readTransferFromLocation, transferPreview } from "./lib/transfer.ts";
import { tutorImport } from "./lib/tutorImport.ts";
import { importReplyFromLocation } from "./lib/tutorLink.ts";
import { upcomingTutoring } from "./lib/tutorSchedule.ts";
import type { DataSource, Homework, Profile } from "./lib/types.ts";
import { reloadToUpdate, watchForUpdates } from "./lib/updates.ts";
import { gmailLink, withGmail } from "./pages/gmailLink.ts";
import { PAGES } from "./pages/runtime.ts";
import { pagesImport } from "./pages/runtime.ts";
import { Assignment } from "./screens/Assignment.tsx";
import { HomeworkScreen } from "./screens/Homework.tsx";
import { SignIn } from "./screens/SignIn.tsx";
import { Today } from "./screens/Today.tsx";
import { Tutor } from "./screens/Tutor.tsx";

type Mode = "loading" | "signin" | "google" | "demo" | "web";

// The web-link build (npm run build:web) is one page published on claude.ai
// with no server of its own: it reaches Gmail and Claude through the page's
// runtime, and falls back to sample data where those aren't available.
const WEB_PAGE = import.meta.env.VITE_WEB_PAGE === "1";

interface WebSession {
  data: DataSource;
  ai: AiProvider | null;
}

async function connectWebPage(): Promise<WebSession> {
  const [db, user, mcp, sample] = await Promise.all([
    useCapability("db"),
    useCapability("user"),
    useCapability("mcp"),
    useCapability("sample"),
  ]);
  const userId = user ? await user.id().catch(() => null) : null;
  const ai = sample ? sampleAi(sample) : null;
  if (mcp || (db && userId)) {
    const data = new ClaudeData(mcp, db, userId, user);
    // On the website, Gmail comes from the student's own Google sign-in.
    return { data: PAGES ? withGmail(data) : data, ai };
  }
  return { data: new DemoData(), ai };
}

export function App() {
  const [auth, setAuth] = useState<GoogleAuth | null>(null);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [mode, setMode] = useState<Mode>("loading");
  const [web, setWeb] = useState<WebSession | null>(null);
  // One data source per sign-in mode; recreating it would reload every screen.
  const session = useMemo<WebSession | null>(() => {
    if (mode === "web") {
      return web;
    }
    if (mode === "google" && auth) {
      return { data: new GoogleData(auth), ai: aiEnabled ? serverAi(() => auth.getToken()) : null };
    }
    return mode === "demo" ? { data: new DemoData(), ai: null } : null;
  }, [mode, auth, aiEnabled, web]);

  useEffect(() => {
    if (WEB_PAGE) {
      void connectWebPage().then((s) => {
        setWeb(s);
        setMode("web");
      });
      return;
    }
    fetch("/api/config")
      .then((r) =>
        r.ok ? (r.json() as Promise<AppConfig>) : Promise.reject(new Error("no config")),
      )
      .catch((): AppConfig => ({ googleClientId: "", aiEnabled: false }))
      .then((cfg) => {
        const googleAuth = cfg.googleClientId ? new GoogleAuth(cfg.googleClientId) : null;
        setAuth(googleAuth);
        setAiEnabled(cfg.aiEnabled);
        setMode(googleAuth?.isSignedIn ? "google" : "signin");
      });
  }, []);

  if (mode === "signin") {
    return (
      <SignIn
        configured={Boolean(auth)}
        onSignIn={async () => {
          await auth?.signIn();
          setMode("google");
        }}
        onDemo={() => setMode("demo")}
      />
    );
  }
  if (!session) {
    return <div className="app" aria-busy="true" />;
  }
  return (
    <Shell
      key={mode}
      data={session.data}
      ai={session.ai}
      auth={mode === "google" ? auth : PAGES ? gmailLink.auth : null}
      onSignOut={
        WEB_PAGE
          ? null
          : () => {
              auth?.signOut();
              setMode("signin");
            }
      }
    />
  );
}

// Screens opened now and then load on first use, so the first open is lighter.
const Lab = lazy(() => import("./lab/Lab.tsx").then((m) => ({ default: m.Lab })));
const Call = lazy(() => import("./screens/Call.tsx").then((m) => ({ default: m.Call })));
const Classes = lazy(() => import("./screens/Classes.tsx").then((m) => ({ default: m.Classes })));
const Inbox = lazy(() => import("./screens/Inbox.tsx").then((m) => ({ default: m.Inbox })));
const Apps = lazy(() => import("./screens/Apps.tsx").then((m) => ({ default: m.Apps })));
const Timetable = lazy(() =>
  import("./screens/Timetable.tsx").then((m) => ({ default: m.Timetable })),
);
const Notifications = lazy(() =>
  import("./screens/Notifications.tsx").then((m) => ({ default: m.Notifications })),
);
const study = () => import("./study/Study.tsx");
const TodoScreen = lazy(() => study().then((m) => ({ default: m.TodoScreen })));
const TestsScreen = lazy(() => study().then((m) => ({ default: m.TestsScreen })));
const NotesScreen = lazy(() => study().then((m) => ({ default: m.NotesScreen })));
const TutoringScreen = lazy(() => study().then((m) => ({ default: m.TutoringScreen })));

/** iPad landscape and bigger: Homework opens tasks beside the list (bento.css .split). */
const WIDE = "(min-width: 1000px) and (min-height: 600px)";

function useWide(): boolean {
  const [wide, setWide] = useState(
    () => typeof matchMedia === "function" && matchMedia(WIDE).matches,
  );
  useEffect(() => {
    if (typeof matchMedia !== "function") {
      return;
    }
    const mq = matchMedia(WIDE);
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}

/** The private link keeps its key in the address; "Add to Home Screen" needs it there. */
const keyInHash = () => /^#(k|import)=/.test(window.location.hash);

function screenFromHash(): Screen {
  if (keyInHash()) {
    return "today";
  }
  const name = window.location.hash.slice(1) as Screen;
  return SCREENS.includes(name) ? name : "today";
}

/** What each history entry remembers, so Back moves between screens (the URL may hold #k=). */
interface NavState {
  pshScreen: Screen;
  /** The screen it was opened from. */
  from?: Screen;
}

function navState(value: unknown): NavState | null {
  const screen = (value as Partial<NavState> | null)?.pshScreen;
  return typeof screen === "string" && SCREENS.includes(screen) ? (value as NavState) : null;
}

function writeHistory(state: NavState, replace: boolean) {
  // With the key in the address, the address stays exactly as it is: only the state changes.
  const url = keyInHash() ? undefined : `#${state.pshScreen}`;
  try {
    if (replace) {
      window.history.replaceState(state, "", url);
    } else {
      window.history.pushState(state, "", url);
    }
  } catch {
    // Some embedded browsers refuse history changes; the screen still changes.
  }
}

interface ToastState {
  text: string;
  action?: ToastAction;
  key: number;
}

function Shell({
  data,
  ai,
  auth,
  onSignOut,
}: {
  data: DataSource;
  ai: AiProvider | null;
  auth: GoogleAuth | null;
  onSignOut: (() => void) | null;
}) {
  const [screen, setScreen] = useState<Screen>(() => {
    const s = screenFromHash();
    return s === "assignment" ? "homework" : s;
  });
  const [profile, setProfile] = useState<Profile | null>(null);
  const [homework, setHomework] = useState<Homework[] | null>(null);
  const [assignment, setAssignment] = useState<Homework | null>(null);
  const [tutorSeed, setTutorSeed] = useState<TutorSeed | null>(null);
  const [aiContext, setAiContext] = useState("");
  const [aiSheet, setAiSheet] = useState<{
    key: number;
    question?: string;
    context: string;
  } | null>(null);
  const [toastMsg, setToastMsg] = useState<ToastState | null>(null);
  const [needReconnect, setNeedReconnect] = useState(false);
  const toastTimer = useRef<number | undefined>(undefined);

  const toast = useCallback((message: string, action?: ToastAction) => {
    setToastMsg({ text: message, action, key: Date.now() });
    window.clearTimeout(toastTimer.current);
    // A little longer when there's something to tap, like Undo.
    toastTimer.current = window.setTimeout(() => setToastMsg(null), action ? 6000 : 4000);
  }, []);

  const handleError = useCallback(
    (err: unknown) => {
      if (err instanceof SignInNeededError) {
        setNeedReconnect(true);
        return;
      }
      console.error(err);
      toast(err instanceof Error ? err.message : "Something went wrong.");
    },
    [toast],
  );

  // A newer build on the website: offer a reload (a home-screen app keeps the old one).
  const [updateReady, setUpdateReady] = useState(false);
  useEffect(() => {
    if (PAGES) {
      watchForUpdates(__BUILD__, () => setUpdateReady(true));
    }
  }, []);

  // Something a tutor sent (opened from their link).
  useEffect(() => {
    const got = tutorImport.take();
    if (got) {
      toast(got);
    }
  }, [toast]);

  // Data just brought over from the claude.ai link (GitHub Pages version).
  useEffect(() => {
    const added = pagesImport.added;
    if (added !== null) {
      pagesImport.added = null;
      toast(
        added > 0
          ? `Brought over from claude.ai: ${added} new homework, plus your timetable, notes and to-dos.`
          : "Up to date with claude.ai: timetable, notes and to-dos brought over.",
      );
    }
  }, [toast]);

  // New Classroom emails become homework; at most once a minute, one at a time.
  const lastSync = useRef(0);
  const syncClassroom = useCallback(
    (known: Homework[], force = false) => {
      if (!force && Date.now() - lastSync.current < 60_000) {
        return;
      }
      lastSync.current = Date.now();
      syncClassroomEmails(data, known).then(
        (added) => {
          if (added.length > 0) {
            setHomework((list) => [...(list ?? []), ...added]);
            toast(`${added.length} new from Classroom: ${added.map((h) => h.title).join(", ")}`);
            const note = newHomeworkReminder(added);
            if (note && notifyPrefs.get().hw) {
              void show(note);
            }
          }
        },
        (err: unknown) => console.warn("Classroom email sync failed", err),
      );
    },
    [data, toast],
  );

  const reloadHomework = useCallback(
    (force = false) => {
      data.homework().then(
        (list) => {
          setHomework(list);
          // Starter homework first, so the email sync sees it and doesn't add it twice.
          applyHomeworkSeed(data, list)
            .catch((err: unknown) => {
              console.warn("Couldn't add starter homework", err);
              return [];
            })
            .then((added) => {
              if (added.length > 0) {
                setHomework((l) => [...(l ?? []), ...added]);
              }
              syncClassroom([...list, ...added], force);
            });
        },
        (err: unknown) => {
          setHomework((h) => h ?? []);
          handleError(err);
        },
      );
    },
    [data, handleError, syncClassroom],
  );

  useEffect(() => {
    reloadHomework();
    data.profile().then(setProfile, handleError);
  }, [data, reloadHomework, handleError]);

  // The phone's back button moves between screens: every screen change is a
  // history entry (the #screen hash, or only the entry's state when #k= is there).
  const screenRef = useRef(screen);
  useEffect(() => {
    try {
      // Mark the entry the app opened on; the address itself is left alone.
      window.history.replaceState({ pshScreen: screenRef.current }, "");
    } catch {
      // History not available: Back just leaves, as before.
    }
  }, []);

  const go = useCallback((next: Screen, replace = false) => {
    const from = screenRef.current;
    screenRef.current = next;
    setScreen(next);
    if (next !== from || replace) {
      writeHistory({ pshScreen: next, from }, replace);
    }
  }, []);

  // "Back to …" buttons: step back when that is where we came from, else swap this entry.
  const back = useCallback(
    (to: Screen) => {
      const state = navState(window.history.state);
      if (state && state.pshScreen === screenRef.current && state.from === to) {
        window.history.back();
      } else {
        go(to, true);
      }
    },
    [go],
  );

  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      if (window.location.hash.startsWith("#tutor=")) {
        return;
      }
      const next = navState(e.state)?.pshScreen ?? screenFromHash();
      screenRef.current = next;
      setScreen(next);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    const onHash = () => {
      // A tutor's link tapped while the app is already open.
      // A tutor's or claude.ai link tapped while the app is already open: it
      // waits for the student's OK in LinkConfirm, like on a fresh load.
      if (window.location.hash.startsWith("#tutor=")) {
        void importReplyFromLocation().catch(() => linkInbox.set(damagedLink("your tutor")));
        return;
      }
      if (PAGES && window.location.hash.startsWith("#import=")) {
        void readTransferFromLocation()
          .catch(() => "damaged" as const)
          .then((t) => {
            if (t === "damaged") {
              linkInbox.set(damagedLink("whoever sent it"));
            } else if (t) {
              linkInbox.set({
                kind: "import",
                transfer: t,
                lines: transferPreview(t, localStorage),
              });
            }
          });
        return;
      }
      if (navState(window.history.state)) {
        // A Back/Forward step: popstate already moved the screen.
        return;
      }
      const next = screenFromHash();
      setScreen((current) => {
        const s = next === "assignment" && current !== "assignment" ? "homework" : next;
        screenRef.current = s;
        return s;
      });
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Keyboard (laptop, iPad keyboard): 1–4 switch tabs, N adds something, / asks
  // the AI. Ignored while typing, with modifier keys, or when a sheet is open.
  useEffect(() => {
    const TABS: Screen[] = ["today", "homework", "tutor", "apps"];
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (
        e.defaultPrevented ||
        e.altKey ||
        e.ctrlKey ||
        e.metaKey ||
        el?.closest("input, textarea, select, [contenteditable='true']") ||
        document.querySelector("[role='dialog'], .backdrop, .tour")
      ) {
        return;
      }
      if (e.key >= "1" && e.key <= "4") {
        go(TABS[Number(e.key) - 1]);
      } else if (e.key === "n" || e.key === "N") {
        document.querySelector<HTMLButtonElement>(".nav-fab")?.click();
      } else if (e.key === "/") {
        go("tutor");
      } else {
        return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  // The tour: once on a new device, when Today has drawn; again from More.
  const [touring, setTouring] = useState(false);
  useEffect(() => {
    if (homework !== null && !tour.seen() && screen === "today") {
      const id = window.setTimeout(() => setTouring(true), 900);
      return () => window.clearTimeout(id);
    }
  }, [homework === null]);

  // Reminders (More › Notifications): checked every minute while the app runs.
  const hwRef = useRef<Homework[]>([]);
  hwRef.current = homework ?? [];
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const list = dueReminders(now, notifyPrefs.get(), {
        homework: hwRef.current,
        lessons: timetable.get(),
        tutoring: upcomingTutoring(tutoring.tutors(), now).map((u) => ({
          name: u.tutor.name,
          start: u.start,
          meet: u.tutor.meet,
        })),
      });
      for (const r of list) {
        void show(r);
      }
    };
    tick();
    const id = window.setInterval(tick, 60_000);
    return () => window.clearInterval(id);
  }, []);

  const ctx = useMemo<AppContext>(
    () => ({
      data,
      ai,
      profile,
      homework,
      reloadHomework,
      replaceHomework: (hw) =>
        setHomework((list) => list?.map((h) => (h.id === hw.id ? hw : h)) ?? null),
      addHomeworkItem: (hw) => setHomework((list) => [...(list ?? []), hw]),
      screen,
      go,
      back,
      assignment,
      openAssignment: (hw) => {
        setAssignment(hw);
        // Switching task beside the list replaces the entry, so Back leaves the task view.
        go("assignment", screenRef.current === "assignment");
      },
      tutorSeed,
      openAi: (request) =>
        setAiSheet({
          key: Date.now(),
          question: request?.question,
          context: request?.context ?? aiContext,
        }),
      aiContext,
      setAiContext,
      askTutor: (text: string, mode: TutorMode = "explain", images?: ImageInput[]) => {
        setTutorSeed({ text, mode, images, key: Date.now() });
        go("tutor");
      },
      handleError,
      toast,
      signOut: onSignOut,
      startTour: () => {
        go("today");
        window.setTimeout(() => setTouring(true), 400);
      },
    }),
    [
      data,
      ai,
      profile,
      homework,
      reloadHomework,
      screen,
      go,
      back,
      assignment,
      tutorSeed,
      aiContext,
      handleError,
      toast,
      onSignOut,
    ],
  );

  const current = screen === "assignment" && !assignment ? "homework" : screen;
  const wide = useWide();
  const split = wide && (current === "homework" || current === "assignment");
  // Shown at the top of Today in demo mode; it scrolls away with the screen.
  const demoBanner = data.demo ? (
    <div className="banner between">
      <span>{WEB_PAGE ? "Sample data · sign in to Claude for your own" : "Demo: sample data"}</span>
      {onSignOut && (
        <button className="btn small dark" onClick={onSignOut}>
          Sign in
        </button>
      )}
    </div>
  ) : null;

  const showAsk = current === "homework" || current === "todo" || current === "inbox";

  return (
    <Ctx.Provider value={ctx}>
      <div className={showAsk ? "app has-ask" : "app"}>
        {updateReady && (
          <div
            className="banner between update-banner"
            role="status"
            style={{ margin: "12px 16px 0" }}
          >
            <span>A new version is ready.</span>
            <button className="btn small dark" onClick={reloadToUpdate}>
              Update now
            </button>
          </div>
        )}
        {needReconnect && auth && (
          <div className="banner between" role="alert" style={{ margin: "12px 16px 0" }}>
            <span>Your Google sign-in expired.</span>
            <button
              className="btn small dark"
              onClick={() =>
                auth.signIn().then(() => {
                  setNeedReconnect(false);
                  reloadHomework();
                }, handleError)
              }
            >
              Reconnect
            </button>
          </div>
        )}
        {current === "today" && <Today demoBanner={demoBanner} />}
        {/* One tree for phone and iPad (.split is display: contents on a phone), so
            turning the iPad never remounts the open task and loses typing. */}
        {(current === "homework" || current === "assignment") && (
          <div className="split">
            {(split || current === "homework") && <HomeworkScreen />}
            {current === "assignment" && assignment ? (
              <Assignment key={assignment.id} hw={assignment} />
            ) : split ? (
              <div className="split-empty">
                <Icon name="bookClosed" size={28} />
                <strong className="h2" style={{ color: "var(--ink)" }}>
                  Pick a homework
                </strong>
                <span className="s13">It opens here, next to your list.</span>
              </div>
            ) : null}
          </div>
        )}
        {current === "tutor" && <Tutor />}
        {(current === "revise" || current === "games") && (
          <Suspense fallback={null}>
            <Lab />
          </Suspense>
        )}
        {current === "inbox" && (
          <Suspense fallback={null}>
            <Inbox />
          </Suspense>
        )}
        <Suspense fallback={null}>
          {current === "apps" && <Apps />}
          {current === "timetable" && <Timetable />}
          {current === "todo" && <TodoScreen />}
          {current === "tests" && <TestsScreen />}
          {current === "notes" && <NotesScreen />}
          {current === "tutoring" && <TutoringScreen />}
          {current === "notifications" && <Notifications />}
        </Suspense>
        {current === "classes" && (
          <Suspense fallback={null}>
            <Classes />
          </Suspense>
        )}
        {current === "call" && (
          <Suspense fallback={null}>
            <Call />
          </Suspense>
        )}
        {showAsk && (
          <button
            className="ask"
            aria-label="Ask AI about this screen"
            onClick={() => setAiSheet({ key: Date.now(), context: aiContext })}
          >
            <Icon name="sparkle" size={16} />
            Ask AI
          </button>
        )}
        {aiSheet && (
          <AskAi
            key={aiSheet.key}
            context={aiSheet.context}
            question={aiSheet.question}
            onClose={() => setAiSheet(null)}
          />
        )}
        {(current !== "assignment" || wide) && (
          <>
            <div className="nav-fade" aria-hidden="true" />
            <NavBar screen={current} go={go} />
          </>
        )}
        <LinkConfirm />
        {touring && <Tour onClose={() => setTouring(false)} />}
        {toastMsg?.text.includes("XP") && <Confetti key={toastMsg.key} />}
        {toastMsg && (
          <div className="toast" role="status">
            <span style={{ flex: 1 }}>{toastMsg.text}</span>
            {toastMsg.action && (
              <button
                className="btn sm toast-action"
                onClick={() => {
                  toastMsg.action?.run();
                  window.clearTimeout(toastTimer.current);
                  setToastMsg(null);
                }}
              >
                {toastMsg.action.label}
              </button>
            )}
            <button
              className="round"
              style={{ width: 32, height: 32 }}
              aria-label="Dismiss"
              onClick={() => setToastMsg(null)}
            >
              <Icon name="close" size={16} />
            </button>
          </div>
        )}
      </div>
    </Ctx.Provider>
  );
}

function NavBar({ screen, go }: { screen: Screen; go: (s: Screen) => void }) {
  const active = (names: Screen[]) => (names.includes(screen) ? "page" : undefined);
  return (
    <nav className="nav" aria-label="Main">
      <button className="nav-item" aria-current={active(["today"])} onClick={() => go("today")}>
        <Icon name="sun" />
        Today
      </button>
      <button
        className="nav-item"
        data-tour="homework"
        aria-current={active(["homework", "assignment", "classes"])}
        onClick={() => go("homework")}
      >
        <Icon name="bookClosed" />
        Homework
      </button>
      {/* The big centre button: paste, photo, voice or type and the AI files it. */}
      <AddAnythingButton variant="fab" />
      <button
        className="nav-item"
        data-tour="ai"
        aria-current={active(["tutor", "call"])}
        onClick={() => go("tutor")}
      >
        <Icon name="sparkles" />
        AI help
      </button>
      <button
        className="nav-item"
        aria-current={active([
          "apps",
          "todo",
          "tests",
          "notes",
          "revise",
          "games",
          "timetable",
          "tutoring",
          "inbox",
          "notifications",
        ])}
        onClick={() => go("apps")}
      >
        <Icon name="grid" />
        More
      </button>
    </nav>
  );
}
