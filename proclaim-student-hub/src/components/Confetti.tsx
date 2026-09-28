import { useCallback, useRef, useState } from "react";

// A short burst of confetti for wins (homework done, a great score).

const COLOURS = ["#6c47ff", "#ff4fa3", "#ffc83d", "#1fb6ff", "#12a150", "#ff7a1a"];

function Burst() {
  const pieces = useRef(
    Array.from({ length: 36 }, (_, i) => ({
      left: Math.random() * 100,
      dx: `${Math.round((Math.random() - 0.5) * 160)}px`,
      spin: `${Math.round(Math.random() * 720 - 360)}deg`,
      delay: `${Math.random() * 0.25}s`,
      colour: COLOURS[i % COLOURS.length],
    })),
  ).current;
  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map((p, i) => (
        <i
          key={i}
          style={
            {
              left: `${p.left}%`,
              background: p.colour,
              animationDelay: p.delay,
              "--dx": p.dx,
              "--spin": p.spin,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

/** Returns the confetti to render and a function that sets it off. */
export function useConfetti(): [React.ReactNode, () => void] {
  const [burst, setBurst] = useState(0);
  const timer = useRef<number | undefined>(undefined);
  const fire = useCallback(() => {
    setBurst(Date.now());
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setBurst(0), 2200);
  }, []);
  return [burst ? <Burst key={burst} /> : null, fire];
}
