"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { PineappleMark } from "@/components/PineappleMark";
import { Transcript } from "@/components/Transcript";
import { formatDuration } from "@/lib/format";
import type { Order } from "@/lib/orders";

const POLL_MS = 2000;

function phaseLabel(order: Order): { title: string; hint: string } {
  if (order.status === "dialing") return { title: "Dialing…", hint: "Connecting the call" };
  if (order.status === "processing") return { title: "Wrapping up…", hint: "Reading the result of the call" };
  if (order.elStatus === "in-progress") return { title: "On the call", hint: "Pineapple is talking to the restaurant" };
  return { title: "Ringing…", hint: "Waiting for the restaurant to pick up" };
}

export function LiveCall({ initialOrder }: { initialOrder: Order }) {
  const router = useRouter();
  const [order, setOrder] = useState(initialOrder);
  const [offline, setOffline] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const transcriptEnd = useRef<HTMLDivElement>(null);

  // Poll the server, which in turn polls ElevenLabs, until the call has a final result.
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch(`/api/orders/${initialOrder.id}`, { cache: "no-store" });
        if (response.status === 401) {
          window.location.href = "/login";
          return;
        }
        if (response.ok) {
          const next = (await response.json()) as Order;
          if (stopped) return;
          setOrder(next);
          setOffline(false);
          if (!["dialing", "calling", "processing"].includes(next.status)) {
            router.refresh(); // The server page now renders the result.
            return;
          }
        } else {
          setOffline(true);
        }
      } catch {
        if (!stopped) setOffline(true);
      }
      if (!stopped) timer = setTimeout(poll, POLL_MS);
    }
    timer = setTimeout(poll, POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [initialOrder.id, router]);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [order.transcript.length]);

  const { title, hint } = phaseLabel(order);
  const elapsed = order.callStartedAt ? (now - new Date(order.callStartedAt).getTime()) / 1000 : 0;

  return (
    <>
      <header className="header">
        <p className="eyebrow">Live call</p>
        <h1 className="title">{order.restaurantName}</h1>
        <p className="subtitle prewrap">{order.items}</p>
      </header>

      <div className="live">
        <div className={order.status === "processing" ? "call-visual call-visual-thinking" : "call-visual"} aria-hidden="true">
          <span className="wave" />
          <span className="wave" />
          <span className="wave" />
          <span className="pine-bounce">
            <PineappleMark size={96} face />
          </span>
        </div>
        <div className="live-text" role="status" aria-live="polite">
          <p className="live-title">{title}</p>
          <p className="live-time">{formatDuration(elapsed)}</p>
          <p className="muted small">{offline ? "Reconnecting…" : hint}</p>
        </div>
      </div>

      <div className="card">
        <p className="label">Live transcript</p>
        <Transcript lines={order.transcript} />
        <div ref={transcriptEnd} />
      </div>

      <p className="muted small center">You can close the app. The call continues and the result appears in History.</p>
    </>
  );
}
