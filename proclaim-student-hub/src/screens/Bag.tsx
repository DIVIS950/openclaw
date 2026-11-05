import { useEffect, useMemo, useState } from "react";
import { BackButton } from "../components/BackButton.tsx";
import { Icon } from "../components/Icon.tsx";
import { useAiContext, useApp } from "../context.ts";
import { bag, buildBag, type BagItem } from "../lib/bag.ts";
import { timetable } from "../lib/store.ts";
import { prepTests } from "../lib/study.ts";
import type { Email } from "../lib/types.ts";

// Pack my bag: tomorrow's checklist. Tick everything for +5 XP.

const KIND_ORDER: BagItem["kind"][] = ["handin", "test", "note", "lesson", "mine", "basic"];
const KIND_LABEL: Record<BagItem["kind"], string> = {
  handin: "Hand in",
  test: "Tests",
  note: "Teachers said",
  lesson: "For your lessons",
  mine: "Your own",
  basic: "Every day",
};

export function Bag() {
  const { data, homework, toast } = useApp();
  const [emails, setEmails] = useState<Email[]>([]);
  const [mine, setMine] = useState(bag.mine);
  const [extra, setExtra] = useState("");
  useEffect(() => {
    data.inbox().then(setEmails, () => setEmails([]));
  }, [data]);

  const plan = useMemo(
    () =>
      buildBag({
        lessons: timetable.get(),
        homework: homework ?? [],
        tests: prepTests.all(),
        emails,
        mine,
      }),
    [homework, emails, mine],
  );
  const [ticks, setTicks] = useState<string[]>(() => bag.ticks(plan.date));
  useEffect(() => setTicks(bag.ticks(plan.date)), [plan.date]);
  const done = plan.items.filter((i) => ticks.includes(i.id)).length;
  const all = plan.items.length;
  const dayName = new Date(`${plan.date}T12:00:00`).toLocaleDateString("en-GB", {
    weekday: "long",
  });
  useAiContext(
    `Pack my bag for ${dayName}: ${plan.items.map((i) => `${i.text}${ticks.includes(i.id) ? " (packed)" : ""}`).join("; ")}`,
  );

  const toggle = (item: BagItem) => {
    const next = ticks.includes(item.id) ? ticks.filter((x) => x !== item.id) : [...ticks, item.id];
    setTicks(next);
    bag.saveTicks(plan.date, next);
    const allTicked = plan.items.every((i) => next.includes(i.id));
    if (allTicked && bag.packed(plan.date)) {
      toast(`Bag packed for ${dayName} +5 XP`);
    }
  };

  const addExtra = () => {
    const t = extra.trim().slice(0, 60);
    if (!t) {
      return;
    }
    bag.addMine("every day", t);
    setMine(bag.mine());
    setExtra("");
  };

  const removeMine = (item: BagItem) => {
    bag.removeMine(item.why === "Every day" ? "every day" : item.why, item.text);
    setMine(bag.mine());
  };

  return (
    <main className="screen bag-screen">
      <BackButton />
      <header className="rise">
        <h1 className="h1">Pack my bag</h1>
        <p className="muted" style={{ margin: "6px 0 0" }}>
          For {dayName}, from your timetable, homework and teachers' notes.
        </p>
      </header>

      <section className="card bag-hero rise d1" aria-label="Packed">
        <span
          className="bag-ring"
          aria-hidden="true"
          style={{ "--fill": all ? done / all : 0 } as React.CSSProperties}
        >
          <Icon name="bag" size={28} />
        </span>
        <span className="stack" style={{ gap: 2 }}>
          <span className="big-num">
            {done}/{all}
          </span>
          <span className="muted s13">
            {done === all && all > 0 ? "All packed. Nice." : "packed"}
          </span>
        </span>
      </section>

      {KIND_ORDER.map((kind) => {
        const items = plan.items.filter((i) => i.kind === kind);
        return (
          items.length > 0 && (
            <section key={kind} className="stack rise d2" style={{ gap: 8 }}>
              <h2 className="eyebrow" style={{ paddingLeft: 4, margin: 0 }}>
                {KIND_LABEL[kind]}
              </h2>
              <div className="card rows">
                {items.map((item) => (
                  <label key={item.id} className="item">
                    <input
                      className="cb"
                      type="checkbox"
                      checked={ticks.includes(item.id)}
                      onChange={() => toggle(item)}
                      aria-label={`Packed: ${item.text}`}
                    />
                    <span className="stack" style={{ gap: 2, flex: 1, minWidth: 0 }}>
                      <span
                        className={ticks.includes(item.id) ? "todo-text done" : "todo-text"}
                        style={{ fontWeight: 600 }}
                      >
                        {item.text}
                      </span>
                      <span className="s11 muted">{item.why}</span>
                    </span>
                    {item.kind === "mine" && (
                      <button
                        type="button"
                        className="round"
                        style={{ width: 32, height: 32 }}
                        aria-label={`Remove ${item.text}`}
                        onClick={(e) => {
                          e.preventDefault();
                          removeMine(item);
                        }}
                      >
                        <Icon name="close" size={14} />
                      </button>
                    )}
                  </label>
                ))}
              </div>
            </section>
          )
        );
      })}

      <form
        className="card row rise d3"
        style={{ gap: 8, padding: 10 }}
        onSubmit={(e) => {
          e.preventDefault();
          addExtra();
        }}
      >
        <input
          className="field"
          style={{ flex: 1, minWidth: 0 }}
          placeholder="Add something you always need"
          aria-label="Add something you always need"
          value={extra}
          maxLength={60}
          onChange={(e) => setExtra(e.target.value)}
        />
        <button className="btn primary" type="submit" disabled={!extra.trim()}>
          <Icon name="plus" size={16} />
          Add
        </button>
      </form>
    </main>
  );
}
