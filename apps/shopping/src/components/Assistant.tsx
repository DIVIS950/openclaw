"use client";

import { ArrowUp, Sparkles, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { getSample, PERMANENT, type SampleError } from "@/lib/claude-page";
import { getProduct, getStore, offersFor } from "@/lib/data";
import { demoAnswer } from "@/lib/demo-ai";
import { SHOPPING_SYSTEM } from "@/lib/prompts";
import { assessStore } from "@/lib/safety";
import { useAppState } from "@/lib/store";
import { Markdown } from "./Markdown";
import { useEnv } from "./Providers";

type Msg = { role: "user" | "assistant"; content: string };

let chatBlocked = false;

/** Standing instructions plus what the shopper is looking at, as a leading user turn. */
function chatRules(opts: { city?: string; productId?: string }) {
  const product = opts.productId ? getProduct(opts.productId) : undefined;
  const offers = product
    ? offersFor(product.id).map((o) => {
        const s = getStore(o.storeId)!;
        return { store: s.name, domain: s.domain, price: o.price, trust: assessStore(s, o.price, product.typicalPrice).score };
      })
    : [];
  return [
    SHOPPING_SYSTEM,
    "You cannot browse the web right now; answer from your knowledge and say prices are estimates.",
    opts.city ? `The shopper lives in ${opts.city}.` : "",
    product ? `They are looking at ${product.brand} ${product.title}. Offers in the app (EUR): ${JSON.stringify(offers)}` : "",
    "Instructions end here. The shopper's messages follow.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function streamChat(messages: Msg[], opts: { city?: string; productId?: string }, onText: (t: string) => void) {
  // Web demo has no server: ask Claude through the viewer's Claude account,
  // or fall back to the built-in rule-based answers.
  if (process.env.NEXT_PUBLIC_ORBIT_STATIC === "1") {
    const sample = chatBlocked ? null : await getSample();
    if (sample) {
      try {
        const { text } = await sample([{ role: "user", content: chatRules(opts) }, ...messages], {
          cache: false,
          onText: ({ text }) => onText(text),
        });
        return text;
      } catch (e) {
        const err = e as SampleError;
        if (err.code === "cancelled") throw e;
        if (PERMANENT.has(err.code)) chatBlocked = true;
        else if (err.text) return err.text;
      }
    }
    const text = demoAnswer(messages[messages.length - 1].content, opts.city, opts.productId);
    for (let i = 6; i < text.length + 6; i += 6) {
      await new Promise((r) => setTimeout(r, 12));
      onText(text.slice(0, i));
    }
    return text;
  }
  const res = await fetch("/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, ...opts }),
  });
  if (!res.ok || !res.body) throw new Error("Assistant unavailable");
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let acc = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    acc += dec.decode(value, { stream: true });
    onText(acc);
  }
  return acc;
}

const SUGGESTIONS = ["Cheapest safe AirPods Pro 3?", "Is megadealz-outlet.shop a scam?", "Fastest way to get a Switch 2", "Best Pixel 10 deal"];

export function Assistant() {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const { address } = useAppState();
  const { aiEnabled } = useEnv();
  const path = usePathname();
  const productId = path.startsWith("/product/") ? path.split("/")[2] : undefined;
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: Event) => {
      setOpen(true);
      const q = (e as CustomEvent<string>).detail;
      if (q) void send(q);
    };
    window.addEventListener("orbit:ask", handler);
    return () => window.removeEventListener("orbit:ask", handler);
  });

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [msgs]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    const next: Msg[] = [...msgs, { role: "user", content: q }];
    setMsgs([...next, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);
    try {
      await streamChat(next, { city: address.city, productId }, (t) => setMsgs([...next, { role: "assistant", content: t }]));
    } catch {
      setMsgs([...next, { role: "assistant", content: "Sorry, I couldn't reach the assistant. Try again in a moment." }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <motion.button
        onClick={() => setOpen(true)}
        whileTap={{ scale: 0.92 }}
        className="fixed bottom-6 right-6 z-40 hidden items-center gap-2 rounded-full bg-ink py-3 pl-3.5 pr-4 text-sm font-semibold text-bg shadow-[0_10px_30px_-8px_rgba(0,0,0,0.45)] md:flex"
        aria-label="Ask Orbit AI"
      >
        <Sparkles size={18} className="text-accent" />
        Ask AI
      </motion.button>

      <AnimatePresence>
        {open && (
          <>
            <motion.div className="fixed inset-0 z-40 bg-black/25 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)} />
            <motion.section
              role="dialog"
              aria-label="Orbit AI assistant"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className="fixed inset-x-0 bottom-0 z-50 flex h-[85dvh] flex-col rounded-t-[28px] border border-line bg-bg shadow-2xl md:inset-x-auto md:bottom-6 md:right-6 md:h-[640px] md:w-[420px] md:rounded-[28px]"
            >
              <div className="flex items-center gap-3 border-b border-line px-5 py-4">
                <span className="grid h-9 w-9 place-items-center rounded-full bg-accent-soft">
                  <Sparkles size={18} className="text-accent" />
                </span>
                <div className="flex-1">
                  <div className="font-serif text-lg font-semibold leading-tight">Orbit AI</div>
                  <div className="text-xs text-muted">{aiEnabled ? "Claude · live web prices" : process.env.NEXT_PUBLIC_ORBIT_STATIC === "1" ? "Claude · estimated prices" : "Demo mode · sample data"}</div>
                </div>
                <button onClick={() => setOpen(false)} className="btn btn-ghost h-9 w-9" aria-label="Close">
                  <X size={18} />
                </button>
              </div>

              <div ref={scroller} className="flex-1 space-y-4 overflow-y-auto px-5 py-4 text-[15px] leading-relaxed">
                {msgs.length === 0 && (
                  <div className="pt-6">
                    <p className="font-serif text-2xl leading-snug">What are you shopping for?</p>
                    <p className="mt-2 text-sm text-muted">I compare every shop, check that they're not scams, and find the right delivery speed for {address.city || "you"}.</p>
                    <div className="mt-5 flex flex-wrap gap-2">
                      {SUGGESTIONS.map((s) => (
                        <button key={s} onClick={() => send(s)} className="rounded-full border border-line bg-surface px-3 py-1.5 text-sm hover:border-accent">
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {msgs.map((m, i) =>
                  m.role === "user" ? (
                    <div key={i} className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-ink px-4 py-2.5 text-bg">
                      {m.content}
                    </div>
                  ) : (
                    <div key={i} className="max-w-[95%]">
                      {m.content ? <Markdown text={m.content} /> : <Thinking />}
                    </div>
                  ),
                )}
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void send(input);
                }}
                className="flex items-end gap-2 border-t border-line p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
              >
                <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about any product or shop…" className="field flex-1" maxLength={2000} />
                <button disabled={!input.trim() || busy} className="btn btn-accent h-11 w-11 shrink-0 disabled:opacity-40" aria-label="Send">
                  <ArrowUp size={20} />
                </button>
              </form>
            </motion.section>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

function Thinking() {
  return (
    <div className="flex items-center gap-1.5 py-2 text-muted" aria-label="Thinking">
      {[0, 1, 2].map((i) => (
        <motion.span key={i} className="h-2 w-2 rounded-full bg-accent" animate={{ opacity: [0.2, 1, 0.2] }} transition={{ duration: 1, repeat: Infinity, delay: i * 0.15 }} />
      ))}
    </div>
  );
}

/** Open the assistant from anywhere, optionally with a question. */
export function askAI(question?: string) {
  window.dispatchEvent(new CustomEvent("orbit:ask", { detail: question }));
}
