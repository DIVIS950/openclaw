import { Icon, type IconName } from "../components/Icon.tsx";
import { LookCard } from "../components/LookCard.tsx";
import { BackupCard, Tools } from "../components/Tools.tsx";
import { useApp, type Screen } from "../context.ts";
import { PAGES } from "../pages/runtime.ts";
import { CLAUDE_PAGE, GmailCard, PagesSettings, SendToWeb } from "../pages/WebVersion.tsx";

interface AppTile {
  name: string;
  url: string;
  icon: IconName;
  bg: string;
  ink: string;
}

const GOOGLE: AppTile[] = [
  {
    name: "Classroom",
    url: "https://classroom.google.com",
    icon: "classroom",
    bg: "#e3f1e6",
    ink: "#1f6b3a",
  },
  { name: "Gmail", url: "https://mail.google.com", icon: "mail", bg: "#fbe4e1", ink: "#a8321f" },
  { name: "Drive", url: "https://drive.google.com", icon: "drive", bg: "#fbf0d2", ink: "#7a5000" },
  { name: "Docs", url: "https://docs.google.com", icon: "doc", bg: "#e4e8fa", ink: "#1c2f8f" },
  {
    name: "Calendar",
    url: "https://calendar.google.com",
    icon: "calendar",
    bg: "#e1eef9",
    ink: "#1d5b8f",
  },
  { name: "Keep", url: "https://keep.google.com", icon: "keep", bg: "#fcefc7", ink: "#7a5500" },
];

const OTHERS: AppTile[] = [
  {
    name: "Dr Frost",
    url: "https://www.drfrost.org",
    icon: "frost",
    bg: "#e0f2f7",
    ink: "#16657a",
  },
  {
    name: "Desmos",
    url: "https://www.desmos.com/calculator",
    icon: "graph",
    bg: "#e6f2e2",
    ink: "#2f6b22",
  },
  {
    name: "Student Desmos",
    url: "https://student.desmos.com",
    icon: "points",
    bg: "#dff1ee",
    ink: "#1b6a5f",
  },
  {
    name: "ActiveLearn",
    url: "https://www.pearsonactivelearn.com",
    icon: "book",
    bg: "#eee6f7",
    ink: "#5b2e91",
  },
  { name: "Canva", url: "https://www.canva.com", icon: "palette", bg: "#e7e4fa", ink: "#4a33a8" },
];

function Tiles({ apps, start }: { apps: AppTile[]; start: number }) {
  return (
    <div className="tiles">
      {apps.map((a, i) => (
        <a
          key={a.name}
          className="tile"
          href={a.url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ animationDelay: `${start + i * 0.05}s` }}
        >
          <span className="tile-icon" style={{ "--tile": a.ink } as React.CSSProperties}>
            <Icon name={a.icon} size={26} />
          </span>
          {a.name}
        </a>
      ))}
    </div>
  );
}

const HUB: { screen: Screen; label: string; icon: IconName; tint: string }[] = [
  { screen: "todo", label: "To-do", icon: "todo", tint: "var(--cyan)" },
  { screen: "tests", label: "Tests", icon: "flag", tint: "var(--coral)" },
  { screen: "notes", label: "Notes", icon: "note", tint: "var(--amber)" },
  { screen: "revise", label: "Revise", icon: "camera", tint: "var(--lime)" },
  { screen: "timetable", label: "Timetable", icon: "calendar", tint: "var(--violet)" },
  { screen: "tutoring", label: "Tutoring", icon: "book", tint: "var(--mint)" },
  { screen: "inbox", label: "Inbox", icon: "mail", tint: "var(--cyan)" },
  { screen: "call", label: "Talk", icon: "mic", tint: "var(--coral)" },
];

export function Apps() {
  const { profile, data, signOut, go } = useApp();
  return (
    <main className="screen" style={{ gap: 18 }}>
      <header className="stack rise" style={{ gap: 4 }}>
        <h1 className="h1">More</h1>
        <p className="sub">Everything else in the hub, one tap away.</p>
      </header>

      <nav className="hub-grid rise" aria-label="Hub">
        {HUB.map((h, i) => (
          <button
            key={h.screen}
            className="hub-tile pop"
            style={{ "--tile": h.tint, animationDelay: `${i * 0.04}s` } as React.CSSProperties}
            onClick={() => go(h.screen)}
          >
            <span className="hub-icon" aria-hidden="true">
              <Icon name={h.icon} size={22} />
            </span>
            {h.label}
          </button>
        ))}
      </nav>

      <Tools />

      <section className="stack">
        <h2 className="eyebrow" style={{ margin: 0 }}>
          Google
        </h2>
        <Tiles apps={GOOGLE} start={0.05} />
      </section>

      <section className="stack">
        <h2 className="eyebrow" style={{ margin: 0 }}>
          Maths, languages &amp; design
        </h2>
        <Tiles apps={OTHERS} start={0.35} />
      </section>

      <LookCard />
      <BackupCard />
      {PAGES && <GmailCard />}
      {PAGES && <PagesSettings />}
      {CLAUDE_PAGE && !data.demo && <SendToWeb />}

      <div className="card row rise" style={{ gap: 12, animationDelay: "0.6s" }}>
        <span style={{ color: "var(--ink)" }}>
          <Icon name="link" size={22} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>
            {PAGES
              ? "Web version"
              : data.demo
                ? "Demo mode"
                : data.hasClassroom
                  ? "Google account connected"
                  : "Connected through Claude"}
          </div>
          <div
            className="muted"
            style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis" }}
          >
            {PAGES
              ? "Saved on this phone. AI with your own key."
              : data.demo
                ? "Sample data. Sign in to see your own."
                : data.hasClassroom
                  ? profile?.email
                  : "Gmail and the AI study buddy use your Claude account."}
          </div>
        </div>
        {signOut && (
          <button className="btn small dark" onClick={signOut}>
            {data.demo ? "Sign in" : "Sign out"}
          </button>
        )}
      </div>
    </main>
  );
}
