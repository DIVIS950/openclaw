"use client";

import { useEffect, useRef } from "react";
import { cn, timeAgo } from "@/lib/utils";
import type { MarketPulse } from "@/lib/types";
import { Zap, TrendingUp, TrendingDown } from "lucide-react";

interface MarketPulseWidgetProps {
  pulse: MarketPulse;
}

export function MarketPulseWidget({ pulse }: MarketPulseWidgetProps) {
  const score = pulse.sentimentScore;

  // Gauge needle angle: 0% = -90deg, 50% = 0deg, 100% = 90deg
  const needleAngle = -90 + (score / 100) * 180;

  let label = "Neutral";
  let labelColor = "#F59E0B";
  if (score >= 75) { label = "Extreme Greed"; labelColor = "#00FF88"; }
  else if (score >= 55) { label = "Greed"; labelColor = "#00CC70"; }
  else if (score >= 45) { label = "Neutral"; labelColor = "#F59E0B"; }
  else if (score >= 25) { label = "Fear"; labelColor = "#FF7A5C"; }
  else { label = "Extreme Fear"; labelColor = "#FF3B5C"; }

  return (
    <div className="glass rounded-xl p-5 border border-[#1E1E22]">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-[#888] uppercase tracking-widest">
          Market Pulse
        </h2>
        <div className="flex items-center gap-1.5 text-[10px] text-[#555]">
          <Zap size={10} className="text-[#F59E0B]" />
          AI Generated · {timeAgo(pulse.generatedAt)}
        </div>
      </div>

      <div className="flex gap-5">
        {/* Gauge */}
        <div className="flex-shrink-0 flex flex-col items-center">
          <div className="relative w-28 h-16 overflow-hidden">
            <svg viewBox="0 0 120 65" className="w-full h-full">
              {/* Background arc */}
              <path
                d="M 10 60 A 50 50 0 0 1 110 60"
                fill="none"
                stroke="#1E1E22"
                strokeWidth="8"
                strokeLinecap="round"
              />
              {/* Fear arc */}
              <path
                d="M 10 60 A 50 50 0 0 1 60 10"
                fill="none"
                stroke="#FF3B5C"
                strokeWidth="8"
                strokeLinecap="round"
                opacity="0.5"
              />
              {/* Neutral arc */}
              <path
                d="M 60 10 A 50 50 0 0 1 110 60"
                fill="none"
                stroke="#00FF88"
                strokeWidth="8"
                strokeLinecap="round"
                opacity="0.5"
              />
              {/* Needle */}
              <g transform={`translate(60, 60) rotate(${needleAngle})`}>
                <line
                  x1="0"
                  y1="4"
                  x2="0"
                  y2="-44"
                  stroke="white"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <circle cx="0" cy="0" r="4" fill="white" />
              </g>
            </svg>
          </div>

          {/* Score */}
          <div className="text-center mt-1">
            <div className="text-2xl font-bold num" style={{ color: labelColor }}>
              {score}
            </div>
            <div className="text-xs font-semibold" style={{ color: labelColor }}>
              {label}
            </div>
          </div>
        </div>

        {/* Summary + factors */}
        <div className="flex-1 min-w-0 space-y-3">
          <p className="text-xs text-[#888] leading-relaxed">
            {pulse.summary}
          </p>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              {pulse.bullishFactors.slice(0, 2).map((f, i) => (
                <div key={i} className="flex items-start gap-1.5">
                  <TrendingUp size={10} className="text-[#00FF88] flex-shrink-0 mt-0.5" />
                  <span className="text-[10px] text-[#666] leading-tight">{f}</span>
                </div>
              ))}
            </div>
            <div className="space-y-1">
              {pulse.bearishFactors.slice(0, 2).map((f, i) => (
                <div key={i} className="flex items-start gap-1.5">
                  <TrendingDown size={10} className="text-[#FF3B5C] flex-shrink-0 mt-0.5" />
                  <span className="text-[10px] text-[#666] leading-tight">{f}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
