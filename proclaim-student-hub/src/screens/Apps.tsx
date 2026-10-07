import { useState } from "react";
import { Icon, type IconName } from "../components/Icon.tsx";
import { LookCard } from "../components/LookCard.tsx";
import { BackupCard, Tools } from "../components/Tools.tsx";
import { useApp, type Screen } from "../context.ts";
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

const HUB: { screen: Screen; label: string; icon: IconName; tint: string }[] = [
  { screen: "todo", label: "To-do", icon: "checkSquare", tint: "var(--cyan)" },
  { screen: "tests", label: "Tests", icon: "timer", tint: "var(--coral)" },
  { screen: "notes", label: "Notes", icon: "pen", tint: "var(--amber)" },
  { screen: "revise", label: "Revise", icon: "flask", tint: "var(--lime)" },
  { screen: "timetable", label: "Timetable", icon: "calendar", tint: "var(--violet)" },
  { screen: "tutoring", label: "Tutoring", icon: "video", tint: "var(--mint)" },
  { screen: "inbox", label: "Inbox", icon: "mail", tint: "var(--cyan)" },
  { screen: "call", label: "Talk", icon: "mic", tint: "var(--coral)" },
];

const HUB_TINT = ["lime", "magenta", "cyan", "violet"] as const;

export function Apps() {
  const { profile, data, signOut, go } = useApp();
  const [moreApps, setMoreApps] = useState(false);
  return (
    <main className="screen" style={{ gap: 12 }}>
      <header className="between rise" style={{ alignItems: "center" }}>
        <h1 className="h1">More</h1>
        <span className="chip">
          {profile?.name ? `${profile.name.split(" ")[0]} · Park Lane` : "Park Lane"}
        </span>
      </header>

      <nav className="hub-grid rise" aria-label="Hub">
        {HUB.map((h, i) => (
          <button key={h.screen} className="tile" onClick={() => go(h.screen)}>
            <span className={`ico ${HUB_TINT[i % 4]}`} aria-hidden="true">
              <Icon name={h.icon} size={18} />
            </span>
            {h.label}
          </button>
        ))}
      </nav>

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

      <section className="card rows rise settings-card">
        <LookCard />
        {PAGES && <AiKeyRow />}
        {PAGES && <GmailCard />}
        {PAGES && <PagesSettings />}
        {CLAUDE_PAGE && !data.demo && <SendToWeb />}
        <BackupCard />
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
