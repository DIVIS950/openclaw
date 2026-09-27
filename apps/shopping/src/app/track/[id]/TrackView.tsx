"use client";

import { ArrowLeft, Check, Copy, Sparkles } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { BoardingPass } from "@/components/BoardingPass";
import { RoadTrip } from "@/components/RoadTrip";
import { WorldMap } from "@/components/WorldMap";
import { cn } from "@/lib/format";
import { heuristicEta, parcelEvents, parcelProgress, parcelStatus } from "@/lib/parcels";
import { useAppState } from "@/lib/store";

type Eta = { eta: number; confidence: number; reasoning: string; source: "claude" | "heuristic" };

export function TrackView({ id }: { id: string }) {
  const { orders } = useAppState();
  const parcel = orders.find((p) => p.id === id);
  const [now, setNow] = useState(() => Date.now());
  const [eta, setEta] = useState<Eta | null>(null);
  const [copied, setCopied] = useState(false);

  // Re-evaluate position every 30 s so the vehicle keeps creeping forward.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!parcel) return;
    setEta({ ...heuristicEta(parcel), source: "heuristic" });
    if (process.env.NEXT_PUBLIC_ORBIT_STATIC === "1") return;
    fetch("/api/ai/eta", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ parcel }) })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Eta | null) => d && setEta(d))
      .catch(() => {});
    // Only refetch when the parcel identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parcel?.id]);

  if (!parcel) {
    return (
      <div className="py-24 text-center">
        <p className="text-muted">Parcel not found on this device.</p>
        <Link href="/orders" className="btn btn-primary mt-4 px-5 py-2">
          Your parcels
        </Link>
      </div>
    );
  }

  const progress = parcelProgress(parcel, now);
  const events = parcelEvents(parcel, now);
  const etaMs = eta?.eta ?? heuristicEta(parcel, now).eta;
  const etaText = new Date(etaMs).toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

  return (
    <div className="mx-auto max-w-4xl">
      <Link href="/orders" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ArrowLeft size={15} /> Parcels
      </Link>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-sm font-semibold uppercase tracking-wider text-accent-ink">{parcelStatus(parcel, now)}</div>
          <h1 className="font-serif text-3xl font-semibold tracking-tight">{parcel.title}</h1>
          <div className="text-sm text-muted">
            {parcel.store} · {parcel.carrier}
          </div>
        </div>
        <button
          onClick={() => {
            void navigator.clipboard?.writeText(parcel.trackingNumber).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          className="btn btn-ghost h-9 px-3 font-mono text-xs"
        >
          {copied ? <Check size={13} /> : <Copy size={13} />} {parcel.trackingNumber}
        </button>
      </div>

      <div className="mt-5">
        <WorldMap parcel={parcel} progress={progress} />
      </div>

      <motion.div initial={{ y: 10 }} animate={{ y: 0 }} className="card mt-4 flex gap-3 p-4">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent-soft">
          <Sparkles size={18} className="text-accent" />
        </span>
        <div className="flex-1">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted">{eta?.source === "claude" ? "Claude's estimate" : "AI estimate"}</div>
          <div className="font-serif text-xl font-semibold">{progress >= 1 ? "Delivered" : etaText}</div>
          {eta && progress < 1 && (
            <>
              <div className="mt-1.5 flex items-center gap-2">
                <div className="h-1.5 w-28 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full rounded-full bg-ok" style={{ width: `${eta.confidence * 100}%` }} />
                </div>
                <span className="text-xs text-muted">{Math.round(eta.confidence * 100)}% confident</span>
              </div>
              <p className="mt-1.5 text-sm text-muted">{eta.reasoning}</p>
            </>
          )}
        </div>
      </motion.div>

      <div className="mt-4">{parcel.mode === "air" ? <BoardingPass parcel={parcel} progress={progress} eta={etaMs} /> : <RoadTrip parcel={parcel} progress={progress} eta={etaMs} />}</div>

      <h2 className="mb-3 mt-8 font-serif text-xl font-semibold">Journey</h2>
      <ol className="card relative space-y-0 p-5">
        {events.map((e, i) => (
          <li key={i} className="relative flex gap-4 pb-5 last:pb-0">
            {i < events.length - 1 && <span className={cn("absolute left-[7px] top-4 h-full w-0.5", events[i + 1].done ? "bg-accent" : "bg-line")} />}
            <span className={cn("relative z-10 mt-1 h-4 w-4 shrink-0 rounded-full border-2", e.done ? "border-accent bg-accent" : "border-line bg-surface")} />
            <div className={cn(!e.done && "opacity-50")}>
              <div className="font-medium">{e.label}</div>
              <div className="text-sm text-muted">
                {e.place} · {new Date(e.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                {!e.done && " (expected)"}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
