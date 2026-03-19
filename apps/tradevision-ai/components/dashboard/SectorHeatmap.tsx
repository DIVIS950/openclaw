"use client";

import { cn } from "@/lib/utils";
import type { SectorPerformance } from "@/lib/types";

interface SectorHeatmapProps {
  sectors: SectorPerformance[];
}

function getHeatColor(pct: number): string {
  if (pct > 2) return "rgba(0,255,136,0.25)";
  if (pct > 1) return "rgba(0,255,136,0.15)";
  if (pct > 0) return "rgba(0,255,136,0.07)";
  if (pct > -1) return "rgba(255,59,92,0.07)";
  if (pct > -2) return "rgba(255,59,92,0.15)";
  return "rgba(255,59,92,0.25)";
}

function getTextColor(pct: number): string {
  if (pct >= 0) return "#00FF88";
  return "#FF3B5C";
}

function getBorderColor(pct: number): string {
  if (pct > 1) return "rgba(0,255,136,0.3)";
  if (pct > 0) return "rgba(0,255,136,0.15)";
  if (pct < -1) return "rgba(255,59,92,0.3)";
  return "rgba(255,59,92,0.15)";
}

export function SectorHeatmap({ sectors }: SectorHeatmapProps) {
  // Sort by market cap for sizing
  const maxCap = Math.max(...sectors.map((s) => s.marketCap));

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-[#888] uppercase tracking-widest">
          Sector Heatmap
        </h2>
        <div className="flex items-center gap-3 text-[10px] text-[#555]">
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-sm bg-[#00FF88]/20 border border-[#00FF88]/30" />
            Gaining
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded-sm bg-[#FF3B5C]/20 border border-[#FF3B5C]/30" />
            Losing
          </span>
        </div>
      </div>

      <div className="grid grid-cols-4 md:grid-cols-6 gap-2">
        {sectors.map((sector) => {
          const sizeRatio = sector.marketCap / maxCap;
          const isLarge = sizeRatio > 0.5;

          return (
            <div
              key={sector.sector}
              className={cn(
                "rounded-lg p-3 cursor-pointer transition-all duration-200 border",
                "hover:scale-105 hover:shadow-lg",
                isLarge && "col-span-2"
              )}
              style={{
                backgroundColor: getHeatColor(sector.changePercent),
                borderColor: getBorderColor(sector.changePercent),
              }}
            >
              <div className="text-[10px] text-[#888] font-medium truncate mb-1">
                {sector.sector}
              </div>
              <div
                className="text-sm font-bold num"
                style={{ color: getTextColor(sector.changePercent) }}
              >
                {sector.changePercent >= 0 ? "+" : ""}
                {sector.changePercent.toFixed(2)}%
              </div>
              <div className="text-[9px] text-[#555] mt-0.5">
                ${(sector.marketCap / 1000).toFixed(1)}T
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
