import { AskButton } from "../components/AskButton.tsx";
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
  tint: string;
}

const GOOGLE: AppTile[] = [
  {
    name: "Classroom",
    url: "https://classroom.google.com",
    icon: "classroom",
    tint: "var(--mint)",
  },
  { name: "Gmail", url: "https://mail.google.com", icon: "mail", tint: "var(--coral)" },
  { name: "Drive", url: "https://drive.google.com", icon: "drive", tint: "var(--amber)" },
  { name: "Docs", url: "https://docs.google.com", icon: "doc", tint: "var(--cyan)" },
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
          <span className="tile-icon" style={{ "--tile": a.tint } as React.CSSProperties}>
            <Icon name={a.icon} size={18} />
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
      <header className="between rise">
        <h1 className="h1">More</h1>
        <div className="head-chips">
          {profile?.name && <span className="chip">{profile.name} · Park Lane</span>}
          <AskButton />
        </div>
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
              <Icon name={h.icon} size={20} />
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
