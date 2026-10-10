import { useEffect, useLayoutEffect, useState } from "react";
import { useApp } from "../context.ts";
import { Icon } from "./Icon.tsx";

// The tutorial tour (Bento "Tutorial tour" board): six steps over the real
// Today screen. The page dims, the part being explained is lit with a white
// ring, and a card says what it does. Shows once on a new device; More ›
// Replay the tour shows it again.

const SEEN = "psh.tour";

interface Step {
  /** CSS selector of the part to light up; null = no highlight. */
  target: string | null;
  title: string;
  body: string;
  cta: string;
}

const STEPS: Step[] = [
  {
    target: null,
    title: "Hey, this is your hub",
    body: "Homework, tests, timetable and an AI helper in one place. A 30-second tour?",
    cta: "Show me",
  },
  {
    target: ".now-card",
    title: "What is happening now",
    body: "Your current lesson, minutes left and the room. Tap Prep me for a two-minute warm-up before class.",
    cta: "Next",
  },
  {
    target: ".brief-card",
    title: "Your day in one line",
    body: "Every morning the AI reads Classroom and your inbox and tells you what matters first.",
    cta: "Next",
  },
  {
    target: ".nav-fab",
    title: "Add anything",
    body: "Paste a message, snap the board or just say it. The AI files it as homework, a test, a to-do or a note.",
    cta: "Next",
  },
  {
    target: '[data-tour="homework"]',
    title: "Tick off homework",
    body: "Swipe a task right when it is done. New Classroom work shows up here by itself.",
    cta: "Next",
  },
  {
    target: '[data-tour="ai"]',
    title: "Stuck? Ask",
    body: "AI help explains, quizzes you or checks your answer. Last step: let the app remind you before things are due.",
    cta: "Turn on alerts",
  },
];

export const tour = {
  seen(): boolean {
    try {
      return localStorage.getItem(SEEN) === "1";
    } catch {
      return true;
    }
  },
  markSeen() {
    try {
      localStorage.setItem(SEEN, "1");
    } catch {
      // Storage blocked: it may show again next time.
    }
  },
};

interface Hole {
  x: number;
  y: number;
  w: number;
  h: number;
  r: number;
}

export function Tour({ onClose }: { onClose: () => void }) {
  const { go } = useApp();
  const [i, setI] = useState(0);
  const [hole, setHole] = useState<Hole | null>(null);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  // Find the part to light up (and follow it if the window changes size).
  useLayoutEffect(() => {
    const measure = () => {
      const el = step.target ? document.querySelector<HTMLElement>(step.target) : null;
      if (!el) {
        setHole(null);
        return;
      }
      el.scrollIntoView({ block: "nearest" });
      const r = el.getBoundingClientRect();
      const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 16;
      setHole({ x: r.left - 6, y: r.top - 6, w: r.width + 12, h: r.height + 12, r: radius + 6 });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [step.target]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        finish();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const finish = () => {
    tour.markSeen();
    onClose();
  };

  // The card sits under a highlight in the top half, above one in the bottom half.
  const vh = window.innerHeight;
  const below = hole && hole.y + hole.h / 2 < vh / 2;
  const tipStyle: React.CSSProperties = !hole
    ? { top: "50%", transform: "translateY(-50%)" }
    : below
      ? { top: Math.min(hole.y + hole.h + 14, vh - 260) }
      : { bottom: Math.max(vh - hole.y + 14, 24) };

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-label={`Tour step ${i + 1} of 6`}>
      {hole ? (
        <div
          className="tour-hole"
          style={{
            width: hole.w,
            height: hole.h,
            borderRadius: hole.r,
            transform: `translate(${hole.x}px, ${hole.y}px)`,
          }}
        />
      ) : (
        <div className="tour-shade" />
      )}
      <section className="tour-tip" key={i} style={tipStyle}>
        {i === 0 && (
          <span className="tour-badge" aria-hidden="true">
            <Icon name="sparkle" size={28} />
          </span>
        )}
        <span className="eyebrow" style={{ fontWeight: 800 }}>
          Step {i + 1} of 6
        </span>
        <h2 className="h2" style={{ fontSize: 24, fontWeight: 800 }}>
          {step.title}
        </h2>
        <p style={{ margin: 0, color: "var(--ink2)" }}>{step.body}</p>
        <div className="between" style={{ gap: 10 }}>
          <div className="tour-dots" aria-hidden="true">
            {STEPS.map((_, k) => (
              <i key={k} className={k === i ? "on" : undefined} />
            ))}
          </div>
          <div className="row" style={{ gap: 6 }}>
            {!last && (
              <button className="tour-skip" onClick={finish}>
                Skip
              </button>
            )}
            <button
              className="btn primary"
              onClick={() => {
                if (last) {
                  finish();
                  go("notifications");
                } else {
                  setI(i + 1);
                }
              }}
            >
              {step.cta}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
