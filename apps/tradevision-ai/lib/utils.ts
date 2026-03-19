import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Signal, Sentiment } from "./types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ─── Number Formatting ────────────────────────────────────────────────────────

export function formatPrice(price: number, decimals = 2): string {
  if (price >= 1000) {
    return price.toLocaleString("en-US", {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }
  return price.toFixed(decimals);
}

export function formatChange(change: number, decimals = 2): string {
  const sign = change >= 0 ? "+" : "";
  return `${sign}${change.toFixed(decimals)}`;
}

export function formatPercent(pct: number, decimals = 2): string {
  const sign = pct >= 0 ? "+" : "";
  return `${sign}${pct.toFixed(decimals)}%`;
}

export function formatMarketCap(cap: number): string {
  if (cap >= 1e12) return `$${(cap / 1e12).toFixed(2)}T`;
  if (cap >= 1e9) return `$${(cap / 1e9).toFixed(2)}B`;
  if (cap >= 1e6) return `$${(cap / 1e6).toFixed(2)}M`;
  return `$${cap.toLocaleString()}`;
}

export function formatVolume(vol: number): string {
  if (vol >= 1e9) return `${(vol / 1e9).toFixed(2)}B`;
  if (vol >= 1e6) return `${(vol / 1e6).toFixed(2)}M`;
  if (vol >= 1e3) return `${(vol / 1e3).toFixed(1)}K`;
  return vol.toString();
}

export function formatNumber(n: number, decimals = 2): string {
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(decimals)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(decimals)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(decimals)}K`;
  return n.toFixed(decimals);
}

// ─── Signal Helpers ───────────────────────────────────────────────────────────

export function signalLabel(signal: Signal): string {
  const labels: Record<Signal, string> = {
    strong_buy: "STRONG BUY",
    buy: "BUY",
    hold: "HOLD",
    sell: "SELL",
    strong_sell: "STRONG SELL",
  };
  return labels[signal];
}

export function signalColor(signal: Signal): string {
  const colors: Record<Signal, string> = {
    strong_buy: "#00FF88",
    buy: "#00FF88",
    hold: "#F59E0B",
    sell: "#FF3B5C",
    strong_sell: "#FF3B5C",
  };
  return colors[signal];
}

export function signalBgColor(signal: Signal): string {
  const colors: Record<Signal, string> = {
    strong_buy: "rgba(0,255,136,0.15)",
    buy: "rgba(0,255,136,0.10)",
    hold: "rgba(245,158,11,0.15)",
    sell: "rgba(255,59,92,0.10)",
    strong_sell: "rgba(255,59,92,0.15)",
  };
  return colors[signal];
}

export function signalTextClass(signal: Signal): string {
  if (signal === "strong_buy" || signal === "buy") return "text-[#00FF88]";
  if (signal === "hold") return "text-[#F59E0B]";
  return "text-[#FF3B5C]";
}

export function sentimentLabel(sentiment: Sentiment): string {
  return sentiment.charAt(0).toUpperCase() + sentiment.slice(1);
}

export function sentimentColor(sentiment: Sentiment): string {
  if (sentiment === "bullish") return "#00FF88";
  if (sentiment === "bearish") return "#FF3B5C";
  return "#F59E0B";
}

// ─── Date Helpers ─────────────────────────────────────────────────────────────

export function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

// ─── Market Status ────────────────────────────────────────────────────────────

export function isMarketOpen(): boolean {
  const now = new Date();
  // Convert to ET
  const etOffset = -5; // EST (adjust for DST as needed)
  const etHour = (now.getUTCHours() + etOffset + 24) % 24;
  const etMinute = now.getUTCMinutes();
  const day = now.getUTCDay(); // 0=Sun, 6=Sat

  // Weekdays only
  if (day === 0 || day === 6) return false;

  // 9:30 AM - 4:00 PM ET
  const openMinutes = 9 * 60 + 30;
  const closeMinutes = 16 * 60;
  const currentMinutes = etHour * 60 + etMinute;

  return currentMinutes >= openMinutes && currentMinutes < closeMinutes;
}

export function getMarketTimeET(): string {
  const now = new Date();
  return now.toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

// ─── Chart helpers ────────────────────────────────────────────────────────────

export function generateSparkline(
  basePrice: number,
  points = 20,
  volatility = 0.02
): number[] {
  const data: number[] = [basePrice];
  for (let i = 1; i < points; i++) {
    const last = data[i - 1];
    const change = last * (1 + (Math.random() - 0.48) * volatility);
    data.push(parseFloat(change.toFixed(2)));
  }
  return data;
}

export function pricePosition(current: number, low: number, high: number): number {
  if (high === low) return 50;
  return Math.round(((current - low) / (high - low)) * 100);
}

// ─── Color helpers ────────────────────────────────────────────────────────────

export function changeColor(change: number): string {
  return change >= 0 ? "#00FF88" : "#FF3B5C";
}

export function changeTextClass(change: number): string {
  return change >= 0 ? "text-[#00FF88]" : "text-[#FF3B5C]";
}

export function changeBgClass(change: number): string {
  return change >= 0 ? "bg-tv-green-dim" : "bg-tv-red-dim";
}

// ─── Logo URL helper ───────────────────────────────────────────────────────────

export function getLogoUrl(ticker: string): string {
  const domain = tickerToDomain[ticker.toUpperCase()];
  if (domain) return `https://logo.clearbit.com/${domain}`;
  return `https://logo.clearbit.com/${ticker.toLowerCase()}.com`;
}

const tickerToDomain: Record<string, string> = {
  AAPL: "apple.com",
  MSFT: "microsoft.com",
  GOOGL: "google.com",
  GOOG: "google.com",
  AMZN: "amazon.com",
  TSLA: "tesla.com",
  META: "meta.com",
  NVDA: "nvidia.com",
  NFLX: "netflix.com",
  AMD: "amd.com",
  INTC: "intel.com",
  PYPL: "paypal.com",
  UBER: "uber.com",
  LYFT: "lyft.com",
  SPOT: "spotify.com",
  SHOP: "shopify.com",
  SQ: "squareup.com",
  PLTR: "palantir.com",
  COIN: "coinbase.com",
  SNOW: "snowflake.com",
  CRM: "salesforce.com",
  ORCL: "oracle.com",
  IBM: "ibm.com",
  CSCO: "cisco.com",
  QCOM: "qualcomm.com",
  V: "visa.com",
  MA: "mastercard.com",
  JPM: "jpmorganchase.com",
  BAC: "bankofamerica.com",
  GS: "goldmansachs.com",
  MS: "morganstanley.com",
  WMT: "walmart.com",
  TGT: "target.com",
  COST: "costco.com",
  DIS: "disney.com",
  NKLA: "nikolamotor.com",
  F: "ford.com",
  GM: "gm.com",
  BA: "boeing.com",
  GE: "ge.com",
  XOM: "exxonmobil.com",
  CVX: "chevron.com",
  JNJ: "jnj.com",
  PFE: "pfizer.com",
  MRNA: "modernatx.com",
};

// ─── ID generators ────────────────────────────────────────────────────────────

export function generateId(): string {
  return Math.random().toString(36).slice(2, 11);
}
