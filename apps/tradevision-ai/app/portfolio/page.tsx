"use client";

import { useState, useEffect, useMemo } from "react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { formatPrice, formatPercent, changeTextClass, generateId, cn } from "@/lib/utils";
import { MOCK_QUOTES } from "@/lib/mock-data";
import { Plus, X, Briefcase, TrendingUp, DollarSign } from "lucide-react";
import Link from "next/link";

interface Holding {
  id: string;
  ticker: string;
  shares: number;
  avgBuyPrice: number;
}

const COLORS = [
  "#00FF88", "#3B82F6", "#F59E0B", "#A855F7",
  "#FF3B5C", "#06B6D4", "#EC4899", "#84CC16",
];

const DEMO_HOLDINGS: Holding[] = [
  { id: "1", ticker: "AAPL", shares: 10, avgBuyPrice: 175.0 },
  { id: "2", ticker: "NVDA", shares: 5, avgBuyPrice: 650.0 },
  { id: "3", ticker: "MSFT", shares: 8, avgBuyPrice: 380.0 },
  { id: "4", ticker: "META", shares: 6, avgBuyPrice: 450.0 },
];

export default function PortfolioPage() {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [mounted, setMounted] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ ticker: "", shares: "", avgPrice: "" });

  useEffect(() => {
    setMounted(true);
    try {
      const stored = JSON.parse(
        localStorage.getItem("portfolio") ?? "null"
      ) as Holding[] | null;
      setHoldings(stored ?? DEMO_HOLDINGS);
    } catch {
      setHoldings(DEMO_HOLDINGS);
    }
  }, []);

  const save = (updated: Holding[]) => {
    setHoldings(updated);
    try {
      localStorage.setItem("portfolio", JSON.stringify(updated));
    } catch {}
  };

  const remove = (id: string) => save(holdings.filter((h) => h.id !== id));

  const addHolding = () => {
    const ticker = form.ticker.toUpperCase().trim();
    const shares = parseFloat(form.shares);
    const avgBuyPrice = parseFloat(form.avgPrice);
    if (!ticker || isNaN(shares) || isNaN(avgBuyPrice)) return;

    save([...holdings, { id: generateId(), ticker, shares, avgBuyPrice }]);
    setForm({ ticker: "", shares: "", avgPrice: "" });
    setShowAdd(false);
  };

  const enriched = useMemo(() => {
    return holdings.map((h, i) => {
      const q = MOCK_QUOTES[h.ticker];
      const currentPrice = q?.price ?? h.avgBuyPrice * (1 + (Math.random() - 0.4) * 0.3);
      const currentValue = currentPrice * h.shares;
      const totalCost = h.avgBuyPrice * h.shares;
      const pnl = currentValue - totalCost;
      const pnlPercent = (pnl / totalCost) * 100;
      const dayChange = (q?.changePercent ?? 0) / 100;

      return {
        ...h,
        currentPrice,
        currentValue,
        totalCost,
        pnl,
        pnlPercent,
        dayChange,
        dayChangePercent: q?.changePercent ?? 0,
        name: q?.name ?? h.ticker,
        logoUrl: q?.logoUrl ?? "",
        color: COLORS[i % COLORS.length],
      };
    });
  }, [holdings]);

  const totalValue = enriched.reduce((s, h) => s + h.currentValue, 0);
  const totalCost = enriched.reduce((s, h) => s + h.totalCost, 0);
  const totalPnl = totalValue - totalCost;
  const totalPnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;

  // Performance chart data (mock)
  const perfData = useMemo(() => {
    const days = 30;
    let val = totalCost;
    return Array.from({ length: days }, (_, i) => {
      val = val * (1 + (Math.random() - 0.46) * 0.025);
      const date = new Date();
      date.setDate(date.getDate() - (days - i));
      return {
        date: date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        value: parseFloat(val.toFixed(2)),
      };
    });
  }, [totalCost]);

  if (!mounted) return null;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Briefcase size={22} className="text-[#3B82F6]" />
            Portfolio
          </h1>
          <p className="text-sm text-[#555] mt-1">
            {holdings.length} position{holdings.length !== 1 ? "s" : ""}
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-[#3B82F6]/20 text-[#3B82F6] border border-[#3B82F6]/30 rounded-lg hover:bg-[#3B82F6]/30 transition-colors"
        >
          <Plus size={13} /> Add Position
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Total Value", value: `$${formatPrice(totalValue)}`, sub: "Current portfolio", color: "#3B82F6" },
          {
            label: "Total P&L",
            value: `${totalPnl >= 0 ? "+" : ""}$${formatPrice(Math.abs(totalPnl))}`,
            sub: `${formatPercent(totalPnlPct)} all time`,
            color: totalPnl >= 0 ? "#00FF88" : "#FF3B5C",
          },
          {
            label: "Day Change",
            value: `${totalPnlPct >= 0 ? "+" : ""}$${formatPrice(Math.abs(enriched.reduce((s, h) => s + h.currentValue * h.dayChange, 0)))}`,
            sub: "Today's performance",
            color: "#F59E0B",
          },
        ].map(({ label, value, sub, color }) => (
          <div key={label} className="glass rounded-xl border border-[#1E1E22] p-4">
            <div className="text-[10px] text-[#555] uppercase tracking-widest mb-1">{label}</div>
            <div className="text-xl font-bold num" style={{ color }}>{value}</div>
            <div className="text-[10px] text-[#444] mt-0.5">{sub}</div>
          </div>
        ))}
      </div>

      {/* Charts row */}
      {enriched.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          {/* Donut */}
          <div className="md:col-span-2 glass rounded-xl border border-[#1E1E22] p-4">
            <h3 className="text-xs font-semibold text-[#666] uppercase tracking-widest mb-3">
              Allocation
            </h3>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={enriched}
                    dataKey="currentValue"
                    nameKey="ticker"
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={80}
                    paddingAngle={2}
                  >
                    {enriched.map((h) => (
                      <Cell key={h.id} fill={h.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number) => [`$${formatPrice(value)}`, "Value"]}
                    labelStyle={{ color: "#fff" }}
                    contentStyle={{ background: "#111113", border: "1px solid #1E1E22", borderRadius: 8 }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-1 mt-2">
              {enriched.map((h) => (
                <div key={h.id} className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ background: h.color }} />
                  <span className="text-xs text-[#888] flex-1">{h.ticker}</span>
                  <span className="text-xs num text-[#666]">
                    {((h.currentValue / totalValue) * 100).toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Performance line */}
          <div className="md:col-span-3 glass rounded-xl border border-[#1E1E22] p-4">
            <h3 className="text-xs font-semibold text-[#666] uppercase tracking-widest mb-3">
              30-Day Performance
            </h3>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={perfData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1E1E22" />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: "#555", fontSize: 9 }}
                    tickLine={false}
                    axisLine={false}
                    interval={6}
                  />
                  <YAxis
                    tick={{ fill: "#555", fontSize: 9 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
                  />
                  <Tooltip
                    formatter={(value: number) => [`$${formatPrice(value)}`, "Portfolio Value"]}
                    contentStyle={{ background: "#111113", border: "1px solid #1E1E22", borderRadius: 8 }}
                    labelStyle={{ color: "#888" }}
                  />
                  <Line
                    type="monotone"
                    dataKey="value"
                    stroke="#3B82F6"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* Holdings table */}
      <div className="glass rounded-xl border border-[#1E1E22] overflow-hidden">
        <div className="px-4 py-3 border-b border-[#1E1E22]">
          <h3 className="text-xs font-semibold text-[#666] uppercase tracking-widest">
            Positions
          </h3>
        </div>
        <div className="divide-y divide-[#1E1E22]">
          {enriched.map((h) => (
            <div key={h.id} className="flex items-center gap-4 px-4 py-3 hover:bg-white/[0.02] transition-colors">
              <div className="w-2 h-10 rounded-full flex-shrink-0" style={{ background: h.color }} />
              <div className="flex-1 min-w-0">
                <Link
                  href={`/stocks/${h.ticker}`}
                  className="text-sm font-bold text-white num hover:text-[#3B82F6] transition-colors"
                >
                  {h.ticker}
                </Link>
                <div className="text-xs text-[#555]">
                  {h.shares} shares @ ${formatPrice(h.avgBuyPrice)}
                </div>
              </div>

              <div className="text-right">
                <div className="text-xs text-[#666] num">${formatPrice(h.currentPrice)}</div>
                <div className={cn("text-[10px] num", changeTextClass(h.dayChangePercent))}>
                  {h.dayChangePercent >= 0 ? "▲" : "▼"} {Math.abs(h.dayChangePercent).toFixed(2)}% today
                </div>
              </div>

              <div className="text-right w-24">
                <div className="text-sm num font-bold text-white">${formatPrice(h.currentValue)}</div>
                <div className="text-xs text-[#555] num">value</div>
              </div>

              <div className="text-right w-24">
                <div className={cn("text-sm num font-bold", changeTextClass(h.pnl))}>
                  {h.pnl >= 0 ? "+" : ""}${formatPrice(Math.abs(h.pnl))}
                </div>
                <div className={cn("text-[10px] num", changeTextClass(h.pnlPercent))}>
                  {formatPercent(h.pnlPercent)}
                </div>
              </div>

              <button
                onClick={() => remove(h.id)}
                className="text-[#333] hover:text-[#FF3B5C] transition-colors"
              >
                <X size={15} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Add position modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setShowAdd(false)}
          />
          <div className="relative glass rounded-xl border border-[#2A2A32] p-6 w-full max-w-sm shadow-2xl">
            <h3 className="text-lg font-bold text-white mb-4">Add Position</h3>
            <div className="space-y-3">
              {[
                { label: "Ticker Symbol", key: "ticker", placeholder: "AAPL", type: "text" },
                { label: "Number of Shares", key: "shares", placeholder: "10", type: "number" },
                { label: "Avg Buy Price ($)", key: "avgPrice", placeholder: "150.00", type: "number" },
              ].map(({ label, key, placeholder, type }) => (
                <div key={key}>
                  <label className="text-xs text-[#666] mb-1 block uppercase tracking-wide">
                    {label}
                  </label>
                  <input
                    type={type}
                    placeholder={placeholder}
                    value={form[key as keyof typeof form]}
                    onChange={(e) =>
                      setForm({ ...form, [key]: key === "ticker" ? e.target.value.toUpperCase() : e.target.value })
                    }
                    className="w-full px-3 py-2 text-sm bg-[#111113] border border-[#1E1E22] rounded-lg text-white placeholder-[#444] outline-none focus:border-[#3B82F6] transition-colors num"
                  />
                </div>
              ))}
            </div>
            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setShowAdd(false)}
                className="flex-1 px-4 py-2 text-sm text-[#666] bg-[#111113] border border-[#1E1E22] rounded-lg hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={addHolding}
                className="flex-1 px-4 py-2 text-sm font-medium text-[#09090B] bg-[#00FF88] rounded-lg hover:bg-[#00E07A] transition-colors"
              >
                Add Position
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
