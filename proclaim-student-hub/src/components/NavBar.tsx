import type { Screen } from "../context.ts";
import { AddAnythingButton } from "./AddAnything.tsx";
import { Icon, type IconName } from "./Icon.tsx";

// The tab bar on a phone; on an iPad the side bar, with a button for every
// main screen (rail.css shows the extra ones from iPad width up).

/** Screens that get their own button in the iPad side bar (phones reach them through More). */
const RAIL: { screen: Screen; label: string; icon: IconName; also?: Screen[] }[] = [
  { screen: "timetable", label: "Timetable", icon: "calendar" },
  { screen: "tests", label: "Tests", icon: "timer" },
  { screen: "revise", label: "Revise", icon: "flask", also: ["games"] },
  { screen: "tutoring", label: "Tutoring", icon: "users" },
  { screen: "notes", label: "Notes", icon: "pen" },
  { screen: "inbox", label: "Inbox", icon: "mail" },
  { screen: "evening", label: "Evening", icon: "moon" },
  { screen: "bag", label: "Bag", icon: "bag" },
  { screen: "notifications", label: "Reminders", icon: "bell" },
];

export function NavBar({
  screen,
  go,
  rail,
  late,
  onSearch,
}: {
  screen: Screen;
  go: (s: Screen) => void;
  /** The iPad side bar: every screen above has its own button there. */
  rail: boolean;
  /** Homework past its due date, shown as a red number on Homework. */
  late: number;
  onSearch: () => void;
}) {
  const active = (names: Screen[]) => (names.includes(screen) ? "page" : undefined);
  return (
    <nav className="nav" aria-label="Main">
      {/* Side bar only: not on a phone, where they'd be hidden yet still "current". */}
      {rail && (
        <button className="nav-item rail-only" aria-label="Search" onClick={onSearch}>
          <Icon name="search" />
          Search
        </button>
      )}
      <button className="nav-item" aria-current={active(["today"])} onClick={() => go("today")}>
        <Icon name="sun" />
        Today
      </button>
      <button
        className="nav-item"
        data-tour="homework"
        aria-current={active(["homework", "assignment", "classes"])}
        aria-label={late > 0 ? `Homework, ${late} late` : undefined}
        onClick={() => go("homework")}
      >
        <span className="nav-ic">
          <Icon name="bookClosed" />
          {late > 0 && (
            <span className="nav-badge" aria-hidden="true">
              {late > 9 ? "9+" : late}
            </span>
          )}
        </span>
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
      {rail &&
        RAIL.map((r) => (
          <button
            key={r.screen}
            className="nav-item rail-only"
            aria-current={active([r.screen, ...(r.also ?? [])])}
            onClick={() => go(r.screen)}
          >
            <Icon name={r.icon} />
            {r.label}
          </button>
        ))}
      <button
        className="nav-item"
        aria-current={active(
          rail
            ? ["apps", "todo", "change", "levels"]
            : [
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
              ],
        )}
        onClick={() => go("apps")}
      >
        <Icon name="grid" />
        More
      </button>
    </nav>
  );
}
