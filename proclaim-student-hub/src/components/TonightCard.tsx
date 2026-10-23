import { useMemo } from "react";
import { useApp } from "../context.ts";
import { isDue } from "../lab/model.ts";
import { labPacks } from "../lab/store.ts";
import { levelTitle } from "../lib/badges.ts";
import { bag, buildBag } from "../lib/bag.ts";
import { evening, eveningTasks } from "../lib/evening.ts";
import { level, progress, timetable } from "../lib/store.ts";
import { dayOf, prepTests, todos } from "../lib/study.ts";
import { Icon } from "./Icon.tsx";

/** Today's "Tonight" card: the evening plan, the bag and your level, one tap each. */
export function TonightCard() {
  const { homework, go } = useApp();
  const now = useMemo(() => new Date(), []);
  const today = dayOf(now);
  const counts = useMemo(() => {
    const list = homework ?? [];
    const labDue = labPacks
      .all()
      .reduce((n, p) => n + p.items.filter((i) => isDue(i, today)).length, 0);
    const tasks = eveningTasks({
      now,
      homework: list,
      tests: prepTests.all(),
      todos: todos.all(),
      labDue,
      tutoring: [],
      settings: evening.settings(),
    });
    const ticked = evening.ticks(today);
    const left = tasks.filter((t) => !ticked.includes(t.id));
    const packing = buildBag({
      lessons: timetable.get(),
      homework: list,
      tests: prepTests.all(),
      emails: [],
      mine: bag.mine(),
      now,
    });
    const packed = bag
      .ticks(packing.date)
      .filter((id) => packing.items.some((i) => i.id === id)).length;
    return {
      tasks: left.length,
      mins: left.reduce((n, t) => n + t.mins, 0),
      packed,
      items: packing.items.length,
      bagDay: new Date(`${packing.date}T12:00:00`).toLocaleDateString("en-GB", {
        weekday: "short",
      }),
    };
  }, [homework, now, today]);
  const p = progress.get();
  const l = level(p.xp);

  return (
    <section className="card tonight rise d4" aria-label="Tonight">
      <div className="between" style={{ alignItems: "center" }}>
        <h2 className="h2">Tonight</h2>
        <button
          className="level-chip"
          onClick={() => go("levels")}
          aria-label={`Level ${l.level}, ${l.next} XP to the next level. Open Levels & badges`}
        >
          <span className="lv">Lv {l.level}</span>
          <span className="lv-bar" aria-hidden="true">
            <span style={{ width: `${l.percent}%` }} />
          </span>
          <span className="s11">{levelTitle(l.level)}</span>
        </button>
      </div>
      <div className="tonight-grid">
        <button className="tonight-tile t-plan" onClick={() => go("evening")}>
          <span className="ic tone-blue" aria-hidden="true">
            <Icon name="calendar" size={20} />
          </span>
          <span className="stack" style={{ gap: 1, minWidth: 0 }}>
            <strong>Plan my evening</strong>
            <span className="s12 muted">
              {counts.tasks === 0
                ? "Nothing left tonight"
                : `${counts.tasks} to do · ${counts.mins} min`}
            </span>
          </span>
        </button>
        <button className="tonight-tile t-bag" onClick={() => go("bag")}>
          <span className="ic tone-yellow" aria-hidden="true">
            <Icon name="bag" size={20} />
          </span>
          <span className="stack" style={{ gap: 1, minWidth: 0 }}>
            <strong>Pack my bag</strong>
            <span className="s12 muted">
              {counts.packed}/{counts.items} packed for {counts.bagDay}
            </span>
          </span>
        </button>
      </div>
    </section>
  );
}
