import { Icon, type IconName } from "../components/Icon.tsx";
import { useApp, type Screen } from "../context.ts";
import { PAGES } from "../pages/runtime.ts";

// More: everything that isn't a tab, as iOS grouped lists, plus Settings.

interface Row {
  screen: Screen;
  label: string;
  icon: IconName;
  tint: string;
  sub?: string;
}

const WORK: Row[] = [
  { screen: "homework", label: "Homework", icon: "homework", tint: "#007aff" },
  { screen: "todo", label: "To-do", icon: "todo", tint: "#ff9500" },
  { screen: "tests", label: "Tests & grades", icon: "flag", tint: "#ff3b30" },
  { screen: "notes", label: "Notes", icon: "note", tint: "#ffcc00" },
];

const SCHOOL: Row[] = [
  { screen: "classes", label: "Classes", icon: "classroom", tint: "#34c759" },
  { screen: "inbox", label: "Inbox", icon: "mail", tint: "#5856d6" },
  { screen: "tutoring", label: "Tutoring", icon: "book", tint: "#af52de" },
  { screen: "call", label: "Talk to Study Buddy", icon: "mic", tint: "#ff2d55" },
  { screen: "apps", label: "Apps", icon: "apps", tint: "#8e8e93" },
];

function Group({ title, rows }: { title: string; rows: Row[] }) {
  const { go, ai, data } = useApp();
  return (
    <section className="stack rise" style={{ gap: 6 }}>
      <h2 className="eyebrow">{title}</h2>
      <div className="ios-list">
        {rows
          .filter((r) =>
            r.screen === "call" ? Boolean(ai) : r.screen !== "inbox" || !PAGES || data.demo,
          )
          .map((r) => (
            <button key={r.screen} className="ios-row" onClick={() => go(r.screen)}>
              <span
                className="ios-icon"
                style={{ "--tile": r.tint } as React.CSSProperties}
                aria-hidden="true"
              >
                <Icon name={r.icon} size={18} />
              </span>
              <span style={{ flex: 1 }}>{r.label}</span>
              {r.sub && <span className="ios-value">{r.sub}</span>}
              <span className="ios-chevron" aria-hidden="true">
                ›
              </span>
            </button>
          ))}
      </div>
    </section>
  );
}

export function More() {
  const { go, profile } = useApp();
  return (
    <main className="screen ios">
      <header className="ios-header rise">
        <h1 className="h1">More</h1>
      </header>
      <Group title="Work" rows={WORK} />
      <Group title="School" rows={SCHOOL} />
      <section className="stack rise" style={{ gap: 6 }}>
        <div className="ios-list">
          <button className="ios-row" onClick={() => go("settings")}>
            <span
              className="ios-icon"
              style={{ "--tile": "#8e8e93" } as React.CSSProperties}
              aria-hidden="true"
            >
              <Icon name="wand" size={18} />
            </span>
            <span style={{ flex: 1 }}>Settings</span>
            {profile?.name && <span className="ios-value">{profile.name.split(" ")[0]}</span>}
            <span className="ios-chevron" aria-hidden="true">
              ›
            </span>
          </button>
        </div>
      </section>
    </main>
  );
}
