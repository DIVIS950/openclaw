"use client";

import { Search, Sparkles } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { streamChat } from "@/components/Assistant";
import { Markdown } from "@/components/Markdown";
import { ProductCard } from "@/components/ProductCard";
import { searchProducts } from "@/lib/data";
import { useAppState } from "@/lib/store";

export function SearchView() {
  const params = useSearchParams();
  const router = useRouter();
  const q = params.get("q") ?? "";
  const [input, setInput] = useState(q);
  const [summary, setSummary] = useState("");
  const { address } = useAppState();
  const results = searchProducts(q);

  useEffect(() => setInput(q), [q]);

  // Stream an AI buying summary for real queries.
  useEffect(() => {
    if (!q.trim()) return setSummary("");
    let cancelled = false;
    setSummary("");
    streamChat([{ role: "user", content: `Compare the best offers for: ${q}` }], { city: address.city }, (t) => {
      if (!cancelled) setSummary(t);
    }).catch(() => !cancelled && setSummary(""));
    return () => {
      cancelled = true;
    };
  }, [q, address.city]);

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          router.push(`/search?q=${encodeURIComponent(input)}`);
        }}
        className="relative mt-2"
      >
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" size={19} />
        <input autoFocus={!q} value={input} onChange={(e) => setInput(e.target.value)} placeholder="Search products, brands, categories" className="h-12 w-full rounded-full border border-line bg-surface pl-11 pr-4 outline-none focus:border-accent" />
      </form>

      {q && (
        <div className="card mt-5 overflow-hidden">
          <div className="flex items-center gap-2 border-b border-line bg-accent-soft/60 px-4 py-2.5 text-sm font-semibold text-accent-ink">
            <Sparkles size={15} /> AI price check · delivered to {address.city || "you"}
          </div>
          <div className="px-4 py-3 text-[15px] leading-relaxed">
            {summary ? (
              <Markdown text={summary} />
            ) : (
              <div className="space-y-2 py-1">
                <div className="shimmer h-3.5 w-3/4 rounded" />
                <div className="shimmer h-3.5 w-2/3 rounded" />
                <div className="shimmer h-3.5 w-1/2 rounded" />
              </div>
            )}
          </div>
        </div>
      )}

      <h1 className="mb-4 mt-8 font-serif text-2xl font-semibold">{q ? `${results.length} result${results.length === 1 ? "" : "s"} for “${q}”` : "Browse everything"}</h1>
      {results.length ? (
        <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
          {results.map((p, i) => (
            <ProductCard key={p.id} product={p} index={i} />
          ))}
        </div>
      ) : (
        <p className="text-muted">Nothing in the demo catalog matches — ask the AI to search the web instead.</p>
      )}
    </div>
  );
}
