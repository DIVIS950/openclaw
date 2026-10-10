import { createPortal } from "react-dom";

// A burst of yellow and black bits over the whole app: for XP, streaks and
// finished sessions. Cheap (CSS only) and gone in under a second.

export function Confetti({ count = 18, big = false }: { count?: number; big?: boolean }) {
  const bits = Array.from({ length: count }, (_, i) => {
    const a = (i / count) * Math.PI * 2 + (i % 2) * 0.3;
    const r = (big ? 140 : 90) + (i % 3) * 30;
    return {
      dx: `${Math.round(Math.cos(a) * r)}px`,
      dy: `${Math.round(Math.sin(a) * r - (big ? 80 : 40))}px`,
      delay: `${i * 10}ms`,
    };
  });
  return createPortal(
    <div className="burst" aria-hidden="true">
      {bits.map((b, i) => (
        <i
          key={i}
          style={{ "--dx": b.dx, "--dy": b.dy, animationDelay: b.delay } as React.CSSProperties}
        />
      ))}
    </div>,
    document.querySelector(".app") ?? document.body,
  );
}
