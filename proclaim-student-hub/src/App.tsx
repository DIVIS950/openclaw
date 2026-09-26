import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppConfig, TutorMode } from "../shared/api.ts";
import { Icon } from "./components/Icon.tsx";
import { Ctx, SCREENS, type AppContext, type Screen, type TutorSeed } from "./context.ts";
import { DemoData } from "./lib/demoData.ts";
import { GoogleAuth, SignInNeededError } from "./lib/googleAuth.ts";
import { GoogleData } from "./lib/googleData.ts";
import type { DataSource, Homework, Profile } from "./lib/types.ts";
import { Apps } from "./screens/Apps.tsx";
import { Assignment } from "./screens/Assignment.tsx";
import { Games } from "./screens/Games.tsx";
import { HomeworkScreen } from "./screens/Homework.tsx";
import { Inbox } from "./screens/Inbox.tsx";
import { Revise } from "./screens/Revise.tsx";
import { SignIn } from "./screens/SignIn.tsx";
import { Today } from "./screens/Today.tsx";
import { Tutor } from "./screens/Tutor.tsx";

type Mode = "loading" | "signin" | "google" | "demo";

export function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [auth, setAuth] = useState<GoogleAuth | null>(null);
  const [mode, setMode] = useState<Mode>("loading");
  // One data source per sign-in mode; recreating it would reload every screen.
  const data = useMemo<DataSource | null>(
    () =>
      mode === "google" && auth ? new GoogleData(auth) : mode === "demo" ? new DemoData() : null,
    [mode, auth],
  );

  useEffect(() => {
    fetch("/api/config")
      .then((r) =>
        r.ok ? (r.json() as Promise<AppConfig>) : Promise.reject(new Error("no config")),
      )
      .catch((): AppConfig => ({ googleClientId: "", aiEnabled: false }))
      .then((cfg) => {
        const googleAuth = cfg.googleClientId ? new GoogleAuth(cfg.googleClientId) : null;
        setConfig(cfg);
        setAuth(googleAuth);
        setMode(googleAuth?.isSignedIn ? "google" : "signin");
      });
  }, []);

  if (mode === "loading" || !config) {
    return <div className="app" aria-busy="true" />;
  }
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
  if (!data) {
    return <div className="app" aria-busy="true" />;
  }
  return (
    <Shell
      key={mode}
      data={data}
      auth={mode === "google" ? auth : null}
      aiEnabled={config.aiEnabled}
      onSignOut={() => {
        auth?.signOut();
        setMode("signin");
      }}
    />
  );
}

function screenFromHash(): Screen {
  const name = window.location.hash.slice(1) as Screen;
  return SCREENS.includes(name) ? name : "today";
}

function Shell({
  data,
  auth,
  aiEnabled,
  onSignOut,
}: {
  data: DataSource;
  auth: GoogleAuth | null;
  aiEnabled: boolean;
  onSignOut: () => void;
}) {
  const [screen, setScreen] = useState<Screen>(() => {
    const s = screenFromHash();
    return s === "assignment" ? "homework" : s;
  });
  const [profile, setProfile] = useState<Profile | null>(null);
  const [homework, setHomework] = useState<Homework[] | null>(null);
  const [assignment, setAssignment] = useState<Homework | null>(null);
  const [tutorSeed, setTutorSeed] = useState<TutorSeed | null>(null);
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

  const reloadHomework = useCallback(() => {
    data.homework().then(setHomework, (err: unknown) => {
      setHomework((h) => h ?? []);
      handleError(err);
    });
  }, [data, handleError]);

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
      aiToken: () => {
        if (!auth || !aiEnabled) {
          throw new Error("Sign in with Google to use the AI.");
        }
        return auth.getToken();
      },
      canUseAi: Boolean(auth && aiEnabled),
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
      auth,
      aiEnabled,
      profile,
      homework,
      reloadHomework,
      screen,
      go,
      assignment,
      tutorSeed,
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
            <span>Demo mode: sample data only.</span>
            <button className="btn small dark" onClick={onSignOut}>
              Sign in
            </button>
          </div>
        )}
        {current === "today" && <Today />}
        {current === "homework" && <HomeworkScreen />}
        {current === "assignment" && assignment && (
          <Assignment key={assignment.id} hw={assignment} />
        )}
        {current === "tutor" && <Tutor />}
        {current === "revise" && <Revise />}
        {current === "games" && <Games />}
        {current === "inbox" && <Inbox />}
        {current === "apps" && <Apps />}
        <NavBar screen={current} go={go} />
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
        aria-current={active(["homework", "assignment"])}
        onClick={() => go("homework")}
      >
        <Icon name="homework" />
        Homework
      </button>
      <button
        className="nav-item"
        aria-current={active(["tutor", "revise", "games"])}
        onClick={() => go("tutor")}
      >
        <span className="nav-ai">
          <Icon name="sparkle" size={22} />
        </span>
        AI help
      </button>
      <button className="nav-item" aria-current={active(["inbox"])} onClick={() => go("inbox")}>
        <Icon name="mail" />
        Inbox
      </button>
      <button className="nav-item" aria-current={active(["apps"])} onClick={() => go("apps")}>
        <Icon name="apps" />
        Apps
      </button>
    </nav>
  );
}
