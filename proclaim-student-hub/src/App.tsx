import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppConfig, TutorMode } from "../shared/api.ts";
import { AskAi } from "./components/AskAi.tsx";
import { Icon } from "./components/Icon.tsx";
import { Ctx, SCREENS, type AppContext, type Screen, type TutorSeed } from "./context.ts";
import { Lab } from "./lab/Lab.tsx";
import { sampleAi, serverAi, type AiProvider } from "./lib/ai.ts";
import { syncClassroomEmails } from "./lib/classroomSync.ts";
import { ClaudeData } from "./lib/claudeData.ts";
import { useCapability } from "./lib/claudeRuntime.ts";
import { DemoData } from "./lib/demoData.ts";
import { GoogleAuth, SignInNeededError } from "./lib/googleAuth.ts";
import { GoogleData } from "./lib/googleData.ts";
import { applyHomeworkSeed } from "./lib/seed.ts";
import type { DataSource, Homework, Profile } from "./lib/types.ts";
import { pagesImport } from "./pages/runtime.ts";
import { Apps } from "./screens/Apps.tsx";
import { Assignment } from "./screens/Assignment.tsx";
import { Call } from "./screens/Call.tsx";
import { Classes } from "./screens/Classes.tsx";
import { HomeworkScreen } from "./screens/Homework.tsx";
import { Inbox } from "./screens/Inbox.tsx";
import { SignIn } from "./screens/SignIn.tsx";
import { Timetable } from "./screens/Timetable.tsx";
import { Today } from "./screens/Today.tsx";
import { Tutor } from "./screens/Tutor.tsx";
import { NotesScreen, TestsScreen, TodoScreen, TutoringScreen } from "./study/Study.tsx";

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
    return { data: new ClaudeData(mcp, db, userId, user), ai };
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
      auth={mode === "google" ? auth : null}
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

function screenFromHash(): Screen {
  const name = window.location.hash.slice(1) as Screen;
  return SCREENS.includes(name) ? name : "today";
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
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [needReconnect, setNeedReconnect] = useState(false);
  const toastTimer = useRef<number | undefined>(undefined);

  const toast = useCallback((message: string) => {
    setToastMsg(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToastMsg(null), 4000);
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
    (known: Homework[]) => {
      if (Date.now() - lastSync.current < 60_000) {
        return;
      }
      lastSync.current = Date.now();
      syncClassroomEmails(data, known).then(
        (added) => {
          if (added.length > 0) {
            setHomework((list) => [...(list ?? []), ...added]);
            toast(`${added.length} new from Classroom: ${added.map((h) => h.title).join(", ")}`);
          }
        },
        (err: unknown) => console.warn("Classroom email sync failed", err),
      );
    },
    [data, toast],
  );

  const reloadHomework = useCallback(() => {
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
            syncClassroom([...list, ...added]);
          });
      },
      (err: unknown) => {
        setHomework((h) => h ?? []);
        handleError(err);
      },
    );
  }, [data, handleError, syncClassroom]);

  useEffect(() => {
    reloadHomework();
    data.profile().then(setProfile, handleError);
  }, [data, reloadHomework, handleError]);

  // Keep the phone's back button working by mirroring the screen in the URL hash.
  const go = useCallback((next: Screen) => {
    setScreen(next);
    if (window.location.hash.slice(1) !== next) {
      window.location.hash = next;
    }
  }, []);

  useEffect(() => {
    const onHash = () => {
      const next = screenFromHash();
      setScreen((current) =>
        next === "assignment" && current !== "assignment" ? "homework" : next,
      );
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
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
      assignment,
      openAssignment: (hw) => {
        setAssignment(hw);
        go("assignment");
      },
      tutorSeed,
      openAi: (request) =>
        setAiSheet({
          key: Date.now(),
          question: request?.question,
          context: request?.context ?? aiContext,
        }),
      setAiContext,
      askTutor: (text: string, mode: TutorMode = "explain") => {
        setTutorSeed({ text, mode, key: Date.now() });
        go("tutor");
      },
      handleError,
      toast,
      signOut: onSignOut,
    }),
    [
      data,
      ai,
      profile,
      homework,
      reloadHomework,
      screen,
      go,
      assignment,
      tutorSeed,
      aiContext,
      handleError,
      toast,
      onSignOut,
    ],
  );

  const current = screen === "assignment" && !assignment ? "homework" : screen;

  return (
    <Ctx.Provider value={ctx}>
      <div className="app">
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
        {data.demo && current === "today" && (
          <div className="banner between" style={{ margin: "12px 16px 0" }}>
            <span>
              {WEB_PAGE
                ? "Sample data: open this page signed in to Claude to use your own."
                : "Demo mode: sample data only."}
            </span>
            {onSignOut && (
              <button className="btn small dark" onClick={onSignOut}>
                Sign in
              </button>
            )}
          </div>
        )}
        {current === "today" && <Today />}
        {current === "homework" && <HomeworkScreen />}
        {current === "assignment" && assignment && (
          <Assignment key={assignment.id} hw={assignment} />
        )}
        {current === "tutor" && <Tutor />}
        {(current === "revise" || current === "games") && <Lab />}
        {current === "inbox" && <Inbox />}
        {current === "apps" && <Apps />}
        {current === "timetable" && <Timetable />}
        {current === "classes" && <Classes />}
        {current === "call" && <Call />}
        {current === "todo" && <TodoScreen />}
        {current === "tests" && <TestsScreen />}
        {current === "notes" && <NotesScreen />}
        {current === "tutoring" && <TutoringScreen />}
        {current !== "tutor" && current !== "call" && (
          <button
            className="ask-fab pop"
            aria-label="Ask AI about this screen"
            onClick={() => setAiSheet({ key: Date.now(), context: aiContext })}
          >
            <Icon name="sparkle" size={20} />
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
        <NavBar screen={current} go={go} />
        {toastMsg?.includes("XP") && <Burst key={toastMsg} />}
        {toastMsg && (
          <div className="toast" role="status">
            <span style={{ flex: 1 }}>{toastMsg}</span>
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

/** A little confetti pop for earned XP. */
function Burst() {
  const bits = Array.from({ length: 14 }, (_, i) => {
    const a = (i / 14) * Math.PI * 2;
    const r = 90 + (i % 3) * 30;
    return { dx: `${Math.round(Math.cos(a) * r)}px`, dy: `${Math.round(Math.sin(a) * r - 40)}px` };
  });
  return (
    <div className="burst" aria-hidden="true">
      {bits.map((b, i) => (
        <i
          key={i}
          style={
            { "--dx": b.dx, "--dy": b.dy, animationDelay: `${i * 12}ms` } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

function NavBar({ screen, go }: { screen: Screen; go: (s: Screen) => void }) {
  const active = (names: Screen[]) => (names.includes(screen) ? "page" : undefined);
  return (
    <nav className="nav" aria-label="Main">
      <button className="nav-item" aria-current={active(["today"])} onClick={() => go("today")}>
        <Icon name="home" />
        Today
      </button>
      <button
        className="nav-item"
        aria-current={active(["homework", "assignment", "classes"])}
        onClick={() => go("homework")}
      >
        <Icon name="homework" />
        Homework
      </button>
      <button className="nav-item" aria-current={active(["todo"])} onClick={() => go("todo")}>
        <Icon name="todo" />
        To-do
      </button>
      <button
        className="nav-item"
        aria-current={active(["tutor", "revise", "games", "call"])}
        onClick={() => go("tutor")}
      >
        <span className="nav-ai">
          <Icon name="sparkle" size={22} />
        </span>
        AI help
      </button>
      <button className="nav-item" aria-current={active(["tests"])} onClick={() => go("tests")}>
        <Icon name="flag" />
        Tests
      </button>
      <button className="nav-item" aria-current={active(["notes"])} onClick={() => go("notes")}>
        <Icon name="note" />
        Notes
      </button>
    </nav>
  );
}
