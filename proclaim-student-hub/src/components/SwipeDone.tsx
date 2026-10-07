import { useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icon.tsx";

/**
 * Swipe right to tick something off: the card slides over a lime "Done" layer.
 * Past 40% of the width the swipe commits; buttons inside still work normally.
 */
export function SwipeDone({
  onDone,
  label = "Done",
  children,
}: {
  onDone: () => void;
  label?: string;
  children: ReactNode;
}) {
  const [x, setX] = useState(0);
  const [gone, setGone] = useState(false);
  const drag = useRef<{ x0: number; y0: number; id: number; live: boolean } | null>(null);
  const el = useRef<HTMLDivElement>(null);

  const start = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button, a, input, textarea, select")) {
      return;
    }
    drag.current = { x0: e.clientX, y0: e.clientY, id: e.pointerId, live: false };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) {
      return;
    }
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    if (!d.live) {
      // A mostly-horizontal move starts the swipe; a vertical one is a scroll.
      if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy)) {
        if (Math.abs(dy) > 8) {
          drag.current = null;
        }
        return;
      }
      d.live = true;
      el.current?.setPointerCapture(d.id);
    }
    setX(Math.max(0, dx));
    e.preventDefault();
  };
  const end = () => {
    const d = drag.current;
    drag.current = null;
    if (!d?.live) {
      return;
    }
    const width = el.current?.offsetWidth ?? 300;
    if (x > width * 0.4) {
      setGone(true);
      setX(width);
      window.setTimeout(onDone, 260);
    } else {
      setX(0);
    }
  };

  return (
    <div
      ref={el}
      className={`swipe${gone ? " gone" : ""}`}
      onPointerDown={start}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <div className="under" aria-hidden="true" style={{ opacity: x > 10 ? 1 : 0 }}>
        <Icon name="check" size={18} />
        {label}
      </div>
      <div
        className="over"
        style={{
          transform: `translateX(${x}px)`,
          transition: drag.current?.live ? "none" : "transform .26s cubic-bezier(.3,.8,.3,1)",
        }}
      >
        {children}
      </div>
    </div>
  );
}
