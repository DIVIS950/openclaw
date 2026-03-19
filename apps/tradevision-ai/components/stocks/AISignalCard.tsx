"use client";

import { useState } from "react";
import { SignalBadge } from "@/components/common/SignalBadge";
import { cn, timeAgo } from "@/lib/utils";
import type { AISignal } from "@/lib/types";
import { ChevronDown, ChevronUp, Zap, Shield, Target, AlertTriangle } from "lucide-react";
import { formatPrice } from "@/lib/utils";

interface AISignalCardProps {
  signal: AISignal;
}

function ConfidenceRing({ confidence }: { confidence: number }) {
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (confidence / 100) * circumference;

  const color =
    confidence >= 70 ? "#00FF88" : confidence >= 50 ? "#F59E0B" : "#FF3B5C";

  return (
    <div className="relative w-20 h-20 flex items-center justify-center">
      <svg
        width="80"
        height="80"
        className="absolute inset-0 -rotate-90"
        viewBox="0 0 80 80"
      >
        {/* Track */}
        <circle
          cx="40"
          cy="40"
          r={radius}
          fill="none"
          stroke="#1E1E22"
          strokeWidth="6"
        />
        {/* Progress */}
        <circle
          cx="40"
          cy="40"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          style={{
            filter: `drop-shadow(0 0 6px ${color}80)`,
            transition: "stroke-dashoffset 0.8s ease",
          }}
        />
      </svg>
      <div className="text-center">
        <div className="text-lg font-bold num" style={{ color }}>
          {confidence}
        </div>
        <div className="text-[8px] text-[#555] uppercase tracking-wide">conf.</div>
      </div>
    </div>
  );
}

function RiskMeter({ level }: { level: "low" | "medium" | "high" }) {
  const config = {
    low: { label: "LOW", active: 1, color: "#00FF88" },
    medium: { label: "MED", active: 2, color: "#F59E0B" },
    high: { label: "HIGH", active: 3, color: "#FF3B5C" },
  };
  const { label, active, color } = config[level];

  return (
    <div className="flex items-center gap-2">
      <Shield size={12} className="text-[#555]" />
      <span className="text-[10px] text-[#555]">Risk:</span>
      <div className="flex gap-1">
        {[1, 2, 3].map((n) => (
          <div
            key={n}
            className="w-4 h-1.5 rounded-full"
            style={{
              backgroundColor: n <= active ? color : "#1E1E22",
              boxShadow: n <= active ? `0 0 4px ${color}60` : "none",
            }}
          />
        ))}
      </div>
      <span className="text-[10px] font-bold" style={{ color }}>
        {label}
      </span>
    </div>
  );
}

export function AISignalCard({ signal }: AISignalCardProps) {
  const [expanded, setExpanded] = useState(false);

  const isBuy = signal.signal === "buy" || signal.signal === "strong_buy";
  const isSell = signal.signal === "sell" || signal.signal === "strong_sell";
  const accentColor = isBuy ? "#00FF88" : isSell ? "#FF3B5C" : "#F59E0B";

  return (
    <div
      className="rounded-xl border p-5 relative overflow-hidden"
      style={{
        borderColor: `${accentColor}30`,
        background: `linear-gradient(135deg, rgba(17,17,19,0.95) 0%, ${accentColor}08 100%)`,
      }}
    >
      {/* Glow orb */}
      <div
        className="absolute -top-12 -right-12 w-40 h-40 rounded-full blur-3xl opacity-20 pointer-events-none"
        style={{ backgroundColor: accentColor }}
      />

      {/* Header */}
      <div className="flex items-start justify-between mb-4 relative">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Zap size={13} style={{ color: accentColor }} />
            <span className="text-[10px] text-[#555] uppercase tracking-widest font-semibold">
              AI Signal
            </span>
          </div>
          <SignalBadge signal={signal.signal} size="lg" />
        </div>
        <ConfidenceRing confidence={signal.confidence} />
      </div>

      {/* Risk + targets */}
      <div className="space-y-2 mb-4">
        <RiskMeter level={signal.riskLevel} />

        {signal.targetPrice && (
          <div className="flex items-center gap-2">
            <Target size={12} className="text-[#555]" />
            <span className="text-[10px] text-[#555]">Target:</span>
            <span className="text-xs num font-bold text-[#00FF88]">
              ${formatPrice(signal.targetPrice)}
            </span>
          </div>
        )}

        {signal.stopLoss && (
          <div className="flex items-center gap-2">
            <AlertTriangle size={12} className="text-[#555]" />
            <span className="text-[10px] text-[#555]">Stop Loss:</span>
            <span className="text-xs num font-bold text-[#FF3B5C]">
              ${formatPrice(signal.stopLoss)}
            </span>
          </div>
        )}
      </div>

      {/* Reasoning preview */}
      <div className="space-y-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-xs text-[#888] hover:text-white transition-colors w-full"
        >
          <span className="font-medium">AI Reasoning</span>
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>

        <div className={cn("space-y-1.5", !expanded && "")}>
          {(expanded ? signal.reasoning : signal.reasoning.slice(0, 2)).map(
            (point, i) => (
              <div key={i} className="flex items-start gap-2">
                <div
                  className="w-1 h-1 rounded-full mt-1.5 flex-shrink-0"
                  style={{ backgroundColor: accentColor }}
                />
                <span className="text-xs text-[#777] leading-relaxed">{point}</span>
              </div>
            )
          )}
          {!expanded && signal.reasoning.length > 2 && (
            <button
              onClick={() => setExpanded(true)}
              className="text-xs text-[#3B82F6] hover:text-[#60A5FA] pl-3"
            >
              +{signal.reasoning.length - 2} more insights
            </button>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="mt-4 pt-3 border-t border-[#1E1E22] flex items-center justify-between">
        <div className="text-[10px] text-[#444]">
          Generated by {signal.modelVersion} · {timeAgo(signal.generatedAt)}
        </div>
      </div>

      {/* Disclaimer */}
      <div className="mt-2 text-[9px] text-[#333] leading-tight">
        ⚠️ AI-generated analysis only. Not financial advice. Do your own research.
      </div>
    </div>
  );
}
