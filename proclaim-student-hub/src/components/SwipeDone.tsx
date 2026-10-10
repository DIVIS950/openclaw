import { useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icon.tsx";

/** Horizontal movement (px) before a touch counts as a swipe rather than a tap. */
const SLOP = 8;

/**
 * Swipe right to tick something off: the card slides over a lime "Done" layer.
 * A swipe can start anywhere on the row, buttons included; a tap still works
 * as a tap, and only a real sideways drag swallows the click that follows.
 * Past 40% of the width the swipe commits.
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
  // Set after a swipe so the click the browser sends on release does nothing.
  const swallowClick = useRef(false);
  const el = useRef<HTMLDivElement>(null);

  const start = (e: React.PointerEvent) => {
    // Text fields keep their own dragging (selecting text); mouse right-clicks don't swipe.
    if (gone || e.button > 0 || (e.target as HTMLElement).closest("input, textarea, select")) {
      return;
    }
    drag.current = { x0: e.clientX, y0: e.clientY, id: e.pointerId, live: false };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || e.pointerId !== d.id) {
      return;
    }
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    if (!d.live) {
      // A mostly-horizontal move starts the swipe; a vertical one is a scroll.
      if (Math.abs(dx) < SLOP || Math.abs(dx) < Math.abs(dy)) {
        if (Math.abs(dy) > SLOP) {
          drag.current = null;
        }
        return;
      }
      d.live = true;
      swallowClick.current = true;
      try {
        el.current?.setPointerCapture(d.id);
      } catch {
        // The pointer is already gone; the swipe ends on the next event.
      }
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
    // The click (if any) follows straight after pointerup; forget the swipe soon after.
    window.setTimeout(() => {
      swallowClick.current = false;
    }, 300);
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
      onClickCapture={(e) => {
        if (swallowClick.current || gone) {
          swallowClick.current = false;
          e.preventDefault();
          e.stopPropagation();
        }
      }}
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
