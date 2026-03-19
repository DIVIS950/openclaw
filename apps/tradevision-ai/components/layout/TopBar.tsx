"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Search, X, Clock } from "lucide-react";
import { cn, isMarketOpen, getMarketTimeET } from "@/lib/utils";
import { MOCK_SEARCH_RESULTS, TRENDING_TICKERS } from "@/lib/mock-data";
import type { SearchResult } from "@/lib/types";

export function TopBar({ sidebarCollapsed }: { sidebarCollapsed: boolean }) {
  const [marketOpen, setMarketOpen] = useState(false);
  const [marketTime, setMarketTime] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Update market time every second
  useEffect(() => {
    const update = () => {
      setMarketOpen(isMarketOpen());
      setMarketTime(getMarketTimeET());
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  // Keyboard shortcut ⌘K
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen(true);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
      if (e.key === "Escape") setSearchOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Close on outside click
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Search handler
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    setLoading(true);
    const timeout = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const data = (await res.json()) as SearchResult[];
        setResults(data);
      } catch {
        const q = query.toLowerCase();
        setResults(
          MOCK_SEARCH_RESULTS.filter(
            (r) =>
              r.ticker.toLowerCase().includes(q) ||
              r.name.toLowerCase().includes(q)
          )
        );
      } finally {
        setLoading(false);
      }
    }, 200);
    return () => clearTimeout(timeout);
  }, [query]);

  const navigateTo = (ticker: string) => {
    setSearchOpen(false);
    setQuery("");
    router.push(`/stocks/${ticker}`);
  };

  return (
    <header
      className={cn(
        "fixed top-0 right-0 z-20 flex items-center gap-4 px-6 py-3",
        "border-b border-[#1E1E22] bg-[#09090B]/90 backdrop-blur-md",
        "transition-all duration-300",
        sidebarCollapsed ? "left-16" : "left-56"
      )}
    >
      {/* Search trigger */}
      <div ref={searchRef} className="relative flex-1 max-w-lg">
        <button
          onClick={() => {
            setSearchOpen(true);
            setTimeout(() => inputRef.current?.focus(), 50);
          }}
          className={cn(
            "flex items-center gap-3 w-full px-4 py-2 rounded-xl",
            "bg-[#111113] border border-[#1E1E22] text-[#666]",
            "hover:border-[#333] hover:text-[#888] transition-all duration-150",
            "cursor-pointer text-sm"
          )}
        >
          <Search size={15} />
          <span>Search stocks, indices, crypto...</span>
          <div className="ml-auto flex items-center gap-1">
            <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-[#1A1A1E] border border-[#2A2A30] rounded text-[#555]">
              ⌘K
            </kbd>
          </div>
        </button>

        {/* Search overlay */}
        {searchOpen && (
          <div className="absolute top-0 left-0 right-0 z-50">
            <div className="bg-[#111113] border border-[#2A2A32] rounded-xl shadow-2xl overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3 border-b border-[#1E1E22]">
                <Search size={16} className="text-[#555] flex-shrink-0" />
                <input
                  ref={inputRef}
                  type="text"
                  placeholder="Search stocks, indices, crypto..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && results[0]) {
                      navigateTo(results[0].ticker);
                    }
                  }}
                  className="flex-1 bg-transparent outline-none text-white text-sm placeholder-[#555]"
                />
                {query && (
                  <button onClick={() => setQuery("")}>
                    <X size={14} className="text-[#555] hover:text-white" />
                  </button>
                )}
                <kbd
                  onClick={() => setSearchOpen(false)}
                  className="cursor-pointer px-1.5 py-0.5 text-[10px] font-mono bg-[#1A1A1E] border border-[#2A2A30] rounded text-[#555] hover:text-white"
                >
                  ESC
                </kbd>
              </div>

              {/* Results */}
              {query ? (
                <div className="py-1 max-h-72 overflow-y-auto">
                  {loading ? (
                    <div className="px-4 py-3 text-sm text-[#555]">Searching...</div>
                  ) : results.length === 0 ? (
                    <div className="px-4 py-3 text-sm text-[#555]">No results for "{query}"</div>
                  ) : (
                    results.map((r) => (
                      <button
                        key={r.ticker}
                        onClick={() => navigateTo(r.ticker)}
                        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 transition-colors text-left"
                      >
                        <div className="w-7 h-7 rounded-lg bg-[#1A1A1E] flex items-center justify-center overflow-hidden flex-shrink-0">
                          <img
                            src={r.logoUrl}
                            alt={r.ticker}
                            className="w-5 h-5 object-contain"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = "none";
                            }}
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-white text-sm font-semibold num">
                              {r.ticker}
                            </span>
                            <span className="text-[10px] text-[#555] bg-[#1A1A1E] px-1.5 py-0.5 rounded">
                              {r.exchange}
                            </span>
                          </div>
                          <div className="text-xs text-[#666] truncate">{r.name}</div>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              ) : (
                <div className="py-3">
                  <div className="px-4 pb-2 text-[10px] text-[#555] uppercase tracking-widest font-semibold">
                    Trending
                  </div>
                  <div className="flex flex-wrap gap-2 px-4">
                    {TRENDING_TICKERS.map((t) => (
                      <button
                        key={t}
                        onClick={() => navigateTo(t)}
                        className="px-3 py-1 text-xs font-mono font-medium text-[#888] bg-[#1A1A1E] rounded-lg hover:text-white hover:bg-[#222] transition-colors"
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Right side */}
      <div className="flex items-center gap-4 ml-auto">
        {/* Market status */}
        <div className="flex items-center gap-2">
          <div
            className={cn(
              "w-2 h-2 rounded-full",
              marketOpen
                ? "bg-[#00FF88] shadow-[0_0_6px_rgba(0,255,136,0.8)] animate-pulse"
                : "bg-[#FF3B5C] shadow-[0_0_6px_rgba(255,59,92,0.8)]"
            )}
          />
          <span className="text-xs text-[#666] hidden sm:block">
            {marketOpen ? "Market Open" : "Market Closed"}
          </span>
        </div>

        {/* ET Clock */}
        <div className="hidden md:flex items-center gap-1.5 text-[#555]">
          <Clock size={13} />
          <span className="text-xs font-mono num">{marketTime} ET</span>
        </div>
      </div>
    </header>
  );
}
