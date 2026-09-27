"use client";

import { Mail, Package, Plane, RefreshCw, Truck } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useState } from "react";
import { useEnv, useUser } from "@/components/Providers";
import { findPlace } from "@/lib/geo";
import { demoParcels, parcelProgress, parcelStatus } from "@/lib/parcels";
import { setAppState, useAppState } from "@/lib/store";

export default function OrdersPage() {
  const { orders, gmailConnected, address } = useAppState();
  const { gmailEnabled } = useEnv();
  const user = useUser();
  const [syncing, setSyncing] = useState(false);
  const [note, setNote] = useState("");

  async function connectGmail() {
    setSyncing(true);
    setNote("");
    try {
      if (gmailEnabled && user?.kind === "google") {
        const r = await fetch("/api/gmail/parcels");
        const data = (await r.json()) as { parcels?: { trackingNumber: string; carrier: string; subject: string }[]; error?: string };
        if (!r.ok) throw new Error(data.error);
        setNote(`Found ${data.parcels?.length ?? 0} tracking numbers in your Gmail. Live carrier tracking connects in the next step.`);
      }
      // Demo parcels stand in for carrier tracking data.
      await new Promise((r) => setTimeout(r, 900));
      const home = findPlace(address.city)?.city ?? "Prague";
      setAppState((s) => ({
        gmailConnected: true,
        orders: [...s.orders.filter((o) => o.source !== "gmail"), ...demoParcels(home)],
      }));
    } catch (e) {
      setNote(e instanceof Error && e.message ? e.message : "Couldn't read Gmail. Try signing in again.");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mt-2 font-serif text-3xl font-semibold tracking-tight">Your parcels</h1>

      <div className="card mt-5 flex items-center gap-4 p-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-accent-soft text-accent-ink">
          <Mail size={20} />
        </span>
        <div className="flex-1">
          <div className="font-medium">{gmailConnected ? "Gmail connected" : "Track everything from Gmail"}</div>
          <div className="text-sm text-muted">
            {gmailConnected ? "Orbit reads shipping emails (read-only) and adds parcels automatically." : "Orbit finds tracking numbers in your shipping emails — even from other shops."}
          </div>
        </div>
        <button onClick={connectGmail} disabled={syncing} className="btn btn-primary h-10 shrink-0 px-4 text-sm">
          {syncing ? <RefreshCw size={15} className="animate-spin" /> : gmailConnected ? <RefreshCw size={15} /> : null}
          {gmailConnected ? "Sync" : "Connect"}
        </button>
      </div>
      {note && <p className="mt-2 text-sm text-muted">{note}</p>}

      {orders.length === 0 ? (
        <div className="py-20 text-center text-muted">
          <Package className="mx-auto mb-3" size={36} strokeWidth={1.4} />
          No parcels yet. Buy something or connect Gmail.
        </div>
      ) : (
        <div className="mt-6 space-y-3">
          {orders.map((p, i) => {
            const t = parcelProgress(p);
            return (
              <motion.div key={p.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
                <Link href={`/track/${p.id}`} className="card flex items-center gap-4 p-4 transition hover:border-accent/50">
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-surface-2">{p.mode === "air" ? <Plane size={20} /> : <Truck size={20} />}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{p.title}</span>
                      {p.source === "gmail" && <span className="rounded-full bg-surface-2 px-1.5 py-0.5 text-[10px] font-semibold text-muted">Gmail</span>}
                    </div>
                    <div className="truncate text-sm text-muted">
                      {parcelStatus(p)} · {p.from.city} → {p.to.city}
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
                      <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(3, t * 100)}%` }} />
                    </div>
                  </div>
                </Link>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
