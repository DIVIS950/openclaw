"use client";

import { money } from "@/lib/format";

type Point = { id: string; store: string; total: number };

/**
 * Dot plot of delivered prices across safe shops, one shared scale from the
 * cheapest to the priciest. Tapping a dot selects that offer.
 */
export function PriceRange({ points, selected, onSelect, hiddenRisky }: { points: Point[]; selected: string; onSelect: (id: string) => void; hiddenRisky: number }) {
  if (points.length < 2) return null;
  const min = Math.min(...points.map((p) => p.total));
  const max = Math.max(...points.map((p) => p.total));
  const span = max - min || 1;
  const pos = (v: number) => ((v - min) / span) * 100;
  const sel = points.find((p) => p.id === selected);

  return (
    <div className="card mt-3 px-5 pb-4 pt-3">
      <div className="flex items-baseline justify-between text-xs text-muted">
        <span className="font-semibold uppercase tracking-wider">Delivered price</span>
        {hiddenRisky > 0 && <span>{hiddenRisky} risky {hiddenRisky === 1 ? "offer" : "offers"} left out</span>}
      </div>
      {/* Label for the selected shop sits above its dot, clamped inside the track. */}
      <div className="relative mt-2 h-5">
        {sel && (
          <span className="absolute -translate-x-1/2 whitespace-nowrap text-xs font-semibold" style={{ left: `clamp(2.5rem, ${pos(sel.total)}%, calc(100% - 2.5rem))` }}>
            {sel.store}
          </span>
        )}
      </div>
      <div className="relative mx-1.5 h-6">
        <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-line" />
        {points.map((p) => {
          const on = p.id === selected;
          return (
            <button
              key={p.id}
              onClick={() => onSelect(p.id)}
              title={`${p.store}: ${money(p.total)} delivered`}
              aria-label={`${p.store}, ${money(p.total)} delivered`}
              aria-pressed={on}
              className="absolute top-1/2 grid h-7 w-7 -translate-x-1/2 -translate-y-1/2 place-items-center"
              style={{ left: `${pos(p.total)}%`, zIndex: on ? 2 : 1 }}
            >
              <span className={on ? "h-4 w-4 rounded-full bg-accent ring-2 ring-surface" : "h-2.5 w-2.5 rounded-full bg-muted ring-2 ring-surface"} />
            </button>
          );
        })}
      </div>
      <div className="mt-1 flex justify-between text-xs tabular-nums">
        <span>
          <b>{money(min)}</b> <span className="text-muted">cheapest</span>
        </span>
        <span className="text-muted">{money(max)}</span>
      </div>
    </div>
  );
}
