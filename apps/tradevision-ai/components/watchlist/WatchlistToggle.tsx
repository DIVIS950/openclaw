"use client";

import { useState, useEffect } from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";

interface WatchlistToggleProps {
  ticker: string;
  name: string;
}

export function WatchlistToggle({ ticker, name }: WatchlistToggleProps) {
  const [watching, setWatching] = useState(false);

  useEffect(() => {
    try {
      const list = JSON.parse(localStorage.getItem("watchlist") ?? "[]") as string[];
      setWatching(list.includes(ticker));
    } catch {
      // ignore
    }
  }, [ticker]);

  const toggle = () => {
    try {
      const list = JSON.parse(localStorage.getItem("watchlist") ?? "[]") as string[];
      const updated = watching
        ? list.filter((t) => t !== ticker)
        : [...list, ticker];
      localStorage.setItem("watchlist", JSON.stringify(updated));

      // Also store name
      const names = JSON.parse(localStorage.getItem("watchlist-names") ?? "{}") as Record<string, string>;
      names[ticker] = name;
      localStorage.setItem("watchlist-names", JSON.stringify(names));

      setWatching(!watching);
    } catch {
      // ignore
    }
  };

  return (
    <button
      onClick={toggle}
      className={cn(
        "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border",
        watching
          ? "text-[#F59E0B] bg-[#F59E0B]/10 border-[#F59E0B]/30 hover:bg-[#F59E0B]/20"
          : "text-[#555] bg-[#111113] border-[#1E1E22] hover:text-white hover:border-[#333]"
      )}
    >
      <Star
        size={13}
        className={cn(watching ? "fill-[#F59E0B]" : "")}
      />
      {watching ? "Watching" : "Watch"}
    </button>
  );
}
