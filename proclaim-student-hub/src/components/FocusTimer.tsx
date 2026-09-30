import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useApp } from "../context.ts";
import { progress, weekLog } from "../lib/store.ts";
import { Icon } from "./Icon.tsx";

// A focus timer for one piece of homework: pick 15/25/45 minutes, keep the
// screen on, and earn XP for finishing.

const LENGTHS = [15, 25, 45];

export function mmss(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function FocusButton({ title }: { title: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn block rise" onClick={() => setOpen(true)}>
        <Icon name="flame" size={16} />
        Focus timer
      </button>
      {open &&
        createPortal(
          <FocusTimer title={title} onClose={() => setOpen(false)} />,
          document.querySelector(".app") ?? document.body,
        )}
    </>
  );
}

interface WakeLock {
  release(): Promise<void>;
}

function FocusTimer({ title, onClose }: { title: string; onClose: () => void }) {
  const { toast } = useApp();
  const [minutes, setMinutes] = useState(25);
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [pausedLeft, setPausedLeft] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const lock = useRef<WakeLock | null>(null);

  const running = endsAt !== null;
  const left = running ? (endsAt - now) / 1000 : (pausedLeft ?? minutes * 60);
  const total = minutes * 60;

  useEffect(() => {
    if (!running) {
      return;
    }
    const t = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(t);
  }, [running]);

  // Keep the screen awake while the timer runs, where the browser allows it.
  useEffect(() => {
    if (!running) {
      return;
    }
    const nav = navigator as unknown as {
      wakeLock?: { request(type: "screen"): Promise<WakeLock> };
    };
    nav.wakeLock
      ?.request("screen")
      .then((l) => {
        lock.current = l;
      })
      .catch(() => {});
    return () => {
      void lock.current?.release().catch(() => {});
      lock.current = null;
    };
  }, [running]);

  useEffect(() => {
    if (running && left <= 0) {
      setEndsAt(null);
      setPausedLeft(null);
      progress.add(10);
      weekLog.add("focus", minutes);
      toast(`${minutes} minutes of focus done! +10 XP. Take a 5 minute break.`);
      onClose();
    }
  }, [running, left]);

  const share = 1 - left / total;

  return (
    <div className="backdrop focus-backdrop">
      <div className="sheet stack focus-sheet" role="dialog" aria-label="Focus timer">
        <div className="muted" style={{ fontSize: 13, fontWeight: 600 }}>
          Focusing on
        </div>
        <strong style={{ fontSize: 17 }}>{title}</strong>
        <div
          className="focus-ring"
          style={{ "--done": `${Math.round(share * 360)}deg` } as React.CSSProperties}
          role="timer"
          aria-label={`${mmss(left)} left`}
        >
          <span>{mmss(left)}</span>
        </div>
        {!running && pausedLeft === null && (
          <div
            className="kind-row"
            role="radiogroup"
            aria-label="Minutes"
            style={{ justifyContent: "center" }}
          >
            {LENGTHS.map((m) => (
              <button
                key={m}
                role="radio"
                aria-checked={minutes === m}
                className="kind-chip"
                onClick={() => setMinutes(m)}
              >
                {m} min
              </button>
            ))}
          </div>
        )}
        <div className="row">
          {running ? (
            <button
              className="btn big"
              style={{ flex: 1 }}
              onClick={() => {
                setPausedLeft(left);
                setEndsAt(null);
              }}
            >
              Pause
            </button>
          ) : (
            <button
              className="btn big primary"
              style={{ flex: 1 }}
              onClick={() => {
                setNow(Date.now());
                setEndsAt(Date.now() + (pausedLeft ?? minutes * 60) * 1000);
              }}
            >
              {pausedLeft !== null ? "Keep going" : "Start"}
            </button>
          )}
          <button className="btn big" onClick={onClose}>
            {running || pausedLeft !== null ? "Stop" : "Close"}
          </button>
        </div>
        <span className="muted" style={{ fontSize: 12, textAlign: "center" }}>
          Phone face down, notifications off. You've got this.
        </span>
      </div>
    </div>
  );
}
