import { useState } from "react";
import { Icon, type IconName } from "../components/Icon.tsx";
import { LookCard } from "../components/LookCard.tsx";
import { BackupCard, Tools } from "../components/Tools.tsx";
import { WeeklyReport } from "../components/WeeklyReport.tsx";
import { useApp, type Screen } from "../context.ts";
import { notifyPrefs } from "../lib/notify.ts";
import { level, progress } from "../lib/store.ts";
import { PAGES } from "../pages/runtime.ts";
import {
  AiKeyRow,
  CLAUDE_PAGE,
  GmailCard,
  PagesSettings,
  SendToWeb,
} from "../pages/WebVersion.tsx";

interface AppTile {
  name: string;
  url: string;
  icon: IconName;
  tint: string;
}

const GOOGLE: AppTile[] = [
  {
    name: "Classroom",
    url: "https://classroom.google.com",
    icon: "cap",
    tint: "var(--mint)",
  },
  { name: "Gmail", url: "https://mail.google.com", icon: "mail", tint: "var(--coral)" },
  { name: "Drive", url: "https://drive.google.com", icon: "driveLogo", tint: "var(--amber)" },
  { name: "Docs", url: "https://docs.google.com", icon: "file", tint: "var(--cyan)" },
  {
    name: "Calendar",
    url: "https://calendar.google.com",
    icon: "calendar",
    tint: "var(--violet)",
  },
  { name: "Keep", url: "https://keep.google.com", icon: "keep", tint: "var(--amber)" },
];

const OTHERS: AppTile[] = [
  {
    name: "Dr Frost",
    url: "https://www.drfrost.org",
    icon: "frost",
    tint: "var(--cyan)",
  },
  {
    name: "Desmos",
    url: "https://www.desmos.com/calculator",
    icon: "graph",
    tint: "var(--lime)",
  },
  {
    name: "Desmos Student",
    url: "https://student.desmos.com",
    icon: "points",
    tint: "var(--mint)",
  },
  {
    name: "ActiveLearn",
    url: "https://www.pearsonactivelearn.com",
    icon: "book",
    tint: "var(--violet)",
  },
  { name: "Canva", url: "https://www.canva.com", icon: "palette", tint: "var(--violet)" },
];

const HUB: { screen: Screen; label: string; icon: IconName; tone: string }[] = [
  { screen: "timetable", label: "Timetable", icon: "calendar", tone: "blue" },
  { screen: "tests", label: "Tests", icon: "timer", tone: "pink" },
  { screen: "revise", label: "Revise", icon: "flask", tone: "violet" },
  { screen: "tutoring", label: "Tutoring", icon: "users", tone: "orange" },
  { screen: "inbox", label: "Inbox", icon: "mail", tone: "blue" },
  { screen: "todo", label: "To-do", icon: "checkSquare", tone: "green" },
  { screen: "notes", label: "Notes", icon: "pen", tone: "yellow" },
  { screen: "call", label: "Talk", icon: "mic", tone: "grey" },
];

export function Apps() {
  const { profile, data, signOut, go, startTour } = useApp();
  const [moreApps, setMoreApps] = useState(false);
  const [stats] = useState(progress.get);
  const [alerts] = useState(() => Object.values(notifyPrefs.get()).filter(Boolean).length);
  const name = profile?.name?.trim() || "Student";
  return (
    <main className="screen">
      <header className="rise">
        <h1 className="h1" style={{ fontSize: 36 }}>
          More
        </h1>
      </header>

      <section className="card profile-card rise d1">
        <span className="me" aria-hidden="true">
          {name[0].toUpperCase()}
        </span>
        <span className="stack" style={{ flex: 1, minWidth: 0, gap: 0 }}>
          <span className="h2">{name}</span>
          <span className="muted s13">Year 9 · Park Lane International</span>
        </span>
        <span className="chip streak">Level {level(stats.xp).level}</span>
      </section>

      <section className="card apps-card rise d2">
        <nav className="app-grid hub-grid" aria-label="Apps">
          {HUB.map((h) => (
            <button key={h.screen} className="app-t" onClick={() => go(h.screen)}>
              <span className={`ic tone-${h.tone}`} aria-hidden="true">
                <Icon name={h.icon} size={24} />
              </span>
              {h.label}
            </button>
          ))}
        </nav>
      </section>

      <section className="card rows rise d3 settings-card">
        <LookCard />
        <button className="set" onClick={() => go("notifications")}>
          <span className="ic tone-orange" aria-hidden="true">
            <Icon name="bell" size={18} />
          </span>
          <span className="label">Notifications</span>
          <span className="muted s13">{alerts} on</span>
          <Icon name="chevron" size={18} />
        </button>
        <button className="set" onClick={startTour}>
          <span className="ic tone-violet" aria-hidden="true">
            <Icon name="compass" size={18} />
          </span>
          <span className="label">Replay the tour</span>
          <Icon name="chevron" size={18} />
        </button>
        {PAGES && <AiKeyRow />}
        {PAGES && <GmailCard />}
        {PAGES && <PagesSettings />}
        {CLAUDE_PAGE && !data.demo && <SendToWeb />}
        <BackupCard />
      </section>

      <WeeklyReport />

      <Tools />

      <section className="stack rise" style={{ gap: 8 }}>
        <div className="between" style={{ paddingLeft: 4 }}>
          <h2 className="eyebrow" style={{ margin: 0 }}>
            Google apps
          </h2>
          <button
            className="btn link s11"
            style={{ minHeight: 28 }}
            onClick={() => setMoreApps((v) => !v)}
          >
            {moreApps ? "− Maths · Languages · Design" : "+ Maths · Languages · Design"}
          </button>
        </div>
        <div className="gapps">
          {GOOGLE.map((a) => (
            <a key={a.name} className="gapp" href={a.url} target="_blank" rel="noopener noreferrer">
              <span>
                <Icon name={a.icon} size={20} />
              </span>
              {a.name}
            </a>
          ))}
        </div>
        {moreApps && (
          <div className="gapps">
            {OTHERS.map((a) => (
              <a
                key={a.name}
                className="gapp"
                href={a.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span>
                  <Icon name={a.icon} size={20} />
                </span>
                {a.name}
              </a>
            ))}
          </div>
        )}
      </section>

      {signOut && (
        <button
          className="btn ghost magenta-text rise"
          style={{ alignSelf: "center" }}
          onClick={signOut}
        >
          {data.demo ? "Sign in" : "Sign out"}
        </button>
      )}
      <p className="muted s12" style={{ textAlign: "center", margin: 0 }}>
        {PAGES
          ? "Web version · saved on this phone"
          : data.demo
            ? "Demo mode · sample data"
            : data.hasClassroom
              ? profile?.email
              : "Connected through Claude"}
      </p>
    </main>
  );
}
