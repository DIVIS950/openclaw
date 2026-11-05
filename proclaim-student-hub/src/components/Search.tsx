import { useMemo, useState } from "react";
import { useApp } from "../context.ts";
import { labPacks } from "../lab/store.ts";
import { HIT_ORDER, searchEverything, type HitKind, type SearchHit } from "../lib/search.ts";
import { timetable } from "../lib/store.ts";
import { labHandoff, noteHandoff, notes, prepTests, testHandoff, todos } from "../lib/study.ts";
import { useEscape } from "../lib/useEscape.ts";
import { Icon, type IconName } from "./Icon.tsx";

// The Search sheet: one box over homework, tests, notes, revision cards,
// to-dos and lessons. Opened from the iPad side bar, More, or Ctrl/Cmd+K.

const KIND: Record<HitKind, { label: string; icon: IconName; tone: string }> = {
  homework: { label: "Homework", icon: "bookClosed", tone: "orange" },
  test: { label: "Tests", icon: "timer", tone: "pink" },
  note: { label: "Notes", icon: "pen", tone: "yellow" },
  card: { label: "Revision cards", icon: "flask", tone: "violet" },
  todo: { label: "To-do", icon: "checkSquare", tone: "green" },
  lesson: { label: "Timetable", icon: "calendar", tone: "blue" },
};

const TRY = ["English", "test", "vocab", "Science"];

export function SearchSheet({ onClose }: { onClose: () => void }) {
  const { homework, go, openAssignment } = useApp();
  const [query, setQuery] = useState("");
  // Read once when the sheet opens: nothing else changes while it's up.
  const [sources] = useState(() => ({
    tests: prepTests.all(),
    notes: notes.all(),
    packs: labPacks.all(),
    todos: todos.all(),
    lessons: timetable.get(),
  }));
  const hits = useMemo(
    () => searchEverything(query, { ...sources, homework: homework ?? [] }),
    [query, sources, homework],
  );
  useEscape(onClose);

  const open = (hit: SearchHit) => {
    onClose();
    if (hit.kind === "homework") {
      const hw = homework?.find((h) => h.id === hit.id);
      if (hw) {
        openAssignment(hw);
      }
    } else if (hit.kind === "test") {
      testHandoff.set(hit.id);
      go("tests");
    } else if (hit.kind === "note") {
      noteHandoff.set(hit.id);
      go("notes");
    } else if (hit.kind === "card" && hit.packId) {
      labHandoff.set({ kind: "open", packId: hit.packId, action: "" });
      go("revise");
    } else if (hit.kind === "todo") {
      go("todo");
    } else {
      go("timetable");
    }
  };

  return (
    <div className="backdrop" onClick={onClose}>
      <div
        className="sheet search-sheet"
        role="dialog"
        aria-label="Search"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="search-box">
          <Icon name="search" size={18} />
          <input
            type="search"
            autoFocus
            value={query}
            placeholder="Search homework, notes, tests, cards…"
            aria-label="Search everything"
            enterKeyHint="go"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && hits[0]) {
                e.preventDefault();
                open(hits[0]);
              }
            }}
          />
          <button className="round" aria-label="Close" onClick={onClose}>
            <Icon name="close" size={16} />
          </button>
        </div>

        {query.trim() === "" ? (
          <div className="stack" style={{ gap: 10 }}>
            <span className="s13 muted">Try</span>
            <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
              {TRY.map((t) => (
                <button key={t} className="chip" onClick={() => setQuery(t)}>
                  {t}
                </button>
              ))}
            </div>
          </div>
        ) : hits.length === 0 ? (
          <p className="muted" style={{ margin: "8px 4px" }}>
            Nothing found for “{query.trim()}”.
          </p>
        ) : (
          <div className="search-results" aria-live="polite">
            {HIT_ORDER.filter((k) => hits.some((h) => h.kind === k)).map((kind) => (
              <section key={kind} className="stack" style={{ gap: 6 }}>
                <h2 className="eyebrow" style={{ margin: "6px 4px 0" }}>
                  {KIND[kind].label}
                </h2>
                <div className="card rows">
                  {hits
                    .filter((h) => h.kind === kind)
                    .map((h) => (
                      <button key={`${h.kind}-${h.id}`} className="li" onClick={() => open(h)}>
                        <span className={`ic tone-${KIND[kind].tone}`} aria-hidden="true">
                          <Icon name={KIND[kind].icon} size={16} />
                        </span>
                        <span className="stack li-main" style={{ gap: 1, minWidth: 0 }}>
                          <span className="li-title">{h.title}</span>
                          {h.sub && <span className="s12 muted li-course">{h.sub}</span>}
                        </span>
                        <Icon name="chevron" size={16} />
                      </button>
                    ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
