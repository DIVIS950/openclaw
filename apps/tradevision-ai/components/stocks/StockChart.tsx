"use client";

import { useEffect, useRef, useState } from "react";
import {
  createChart,
  ColorType,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type CandlestickSeriesOptions,
  type LineSeriesOptions,
  type AreaSeriesOptions,
} from "lightweight-charts";
import { cn } from "@/lib/utils";
import type { CandleData, ChartType, TimeFrame } from "@/lib/types";

const TIME_FRAMES: TimeFrame[] = ["1D", "1W", "1M", "3M", "1Y", "5Y", "MAX"];
const CHART_TYPES: { type: ChartType; label: string }[] = [
  { type: "candlestick", label: "Candle" },
  { type: "line", label: "Line" },
  { type: "area", label: "Area" },
];

interface StockChartProps {
  ticker: string;
  initialData: CandleData[];
  onTimeFrameChange?: (tf: TimeFrame) => void;
}

export function StockChart({ ticker, initialData, onTimeFrameChange }: StockChartProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const chartApiRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick" | "Line" | "Area"> | null>(null);

  const [timeFrame, setTimeFrame] = useState<TimeFrame>("1D");
  const [chartType, setChartType] = useState<ChartType>("candlestick");
  const [data, setData] = useState<CandleData[]>(initialData);
  const [loading, setLoading] = useState(false);
  const [crosshairPrice, setCrosshairPrice] = useState<number | null>(null);

  // Init chart
  useEffect(() => {
    if (!chartRef.current) return;

    const chart = createChart(chartRef.current, {
      width: chartRef.current.clientWidth,
      height: 360,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#666",
        fontSize: 11,
        fontFamily: "'JetBrains Mono', monospace",
      },
      grid: {
        vertLines: { color: "#1E1E22", style: LineStyle.Dotted },
        horzLines: { color: "#1E1E22", style: LineStyle.Dotted },
      },
      crosshair: {
        mode: 1,
        vertLine: {
          color: "#3B82F6",
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: "#111113",
        },
        horzLine: {
          color: "#3B82F6",
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: "#111113",
        },
      },
      rightPriceScale: {
        borderColor: "#1E1E22",
        textColor: "#666",
      },
      timeScale: {
        borderColor: "#1E1E22",
        timeVisible: true,
        secondsVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
      },
    });

    chartApiRef.current = chart;

    // Resize observer
    const resizeObserver = new ResizeObserver(() => {
      if (chartRef.current) {
        chart.applyOptions({ width: chartRef.current.clientWidth });
      }
    });
    resizeObserver.observe(chartRef.current);

    // Crosshair handler
    chart.subscribeCrosshairMove((param) => {
      if (param.seriesData && seriesRef.current) {
        const d = param.seriesData.get(seriesRef.current);
        if (d && "close" in d) {
          setCrosshairPrice((d as { close: number }).close);
        } else if (d && "value" in d) {
          setCrosshairPrice((d as { value: number }).value);
        } else {
          setCrosshairPrice(null);
        }
      }
    });

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartApiRef.current = null;
    };
  }, []);

  // Update series when chart type or data changes
  useEffect(() => {
    const chart = chartApiRef.current;
    if (!chart) return;

    // Remove old series
    if (seriesRef.current) {
      try {
        chart.removeSeries(seriesRef.current);
      } catch {
        // ignore
      }
    }

    const lastClose = data[data.length - 1]?.close ?? 0;
    const isPositive =
      data.length > 1 && lastClose >= data[0].close;
    const lineColor = isPositive ? "#00FF88" : "#FF3B5C";

    if (chartType === "candlestick") {
      const series = chart.addCandlestickSeries({
        upColor: "#00FF88",
        downColor: "#FF3B5C",
        borderUpColor: "#00FF88",
        borderDownColor: "#FF3B5C",
        wickUpColor: "#00FF88",
        wickDownColor: "#FF3B5C",
      });
      series.setData(
        data.map((c) => ({
          time: c.time as unknown as import("lightweight-charts").Time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        }))
      );
      seriesRef.current = series as unknown as ISeriesApi<"Candlestick" | "Line" | "Area">;
    } else if (chartType === "line") {
      const series = chart.addLineSeries({
        color: lineColor,
        lineWidth: 2,
        lastValueVisible: true,
        priceLineVisible: true,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 4,
        crosshairMarkerBackgroundColor: lineColor,
      });
      series.setData(
        data.map((c) => ({
          time: c.time as unknown as import("lightweight-charts").Time,
          value: c.close,
        }))
      );
      seriesRef.current = series as unknown as ISeriesApi<"Candlestick" | "Line" | "Area">;
    } else {
      const series = chart.addAreaSeries({
        lineColor,
        topColor: `${lineColor}30`,
        bottomColor: "transparent",
        lineWidth: 2,
        priceLineVisible: true,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 4,
        crosshairMarkerBackgroundColor: lineColor,
      });
      series.setData(
        data.map((c) => ({
          time: c.time as unknown as import("lightweight-charts").Time,
          value: c.close,
        }))
      );
      seriesRef.current = series as unknown as ISeriesApi<"Candlestick" | "Line" | "Area">;
    }

    chart.timeScale().fitContent();
  }, [data, chartType]);

  // Fetch data when timeframe changes
  const handleTimeFrameChange = async (tf: TimeFrame) => {
    setTimeFrame(tf);
    setLoading(true);
    onTimeFrameChange?.(tf);

    try {
      const res = await fetch(`/api/stock/${ticker}/candles?interval=${tf}`);
      const json = (await res.json()) as CandleData[];
      setData(json);
    } catch {
      // keep existing data
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="glass rounded-xl border border-[#1E1E22] overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#1E1E22]">
        {/* Timeframes */}
        <div className="flex gap-1">
          {TIME_FRAMES.map((tf) => (
            <button
              key={tf}
              onClick={() => handleTimeFrameChange(tf)}
              className={cn(
                "px-2.5 py-1 text-xs font-medium rounded-md transition-all num",
                timeFrame === tf
                  ? "bg-[#3B82F6]/20 text-[#3B82F6] border border-[#3B82F6]/30"
                  : "text-[#555] hover:text-white hover:bg-white/5"
              )}
            >
              {tf}
            </button>
          ))}
        </div>

        {/* Chart type */}
        <div className="flex gap-1 bg-[#0D0D0F] rounded-lg p-1 border border-[#1E1E22]">
          {CHART_TYPES.map(({ type, label }) => (
            <button
              key={type}
              onClick={() => setChartType(type)}
              className={cn(
                "px-2.5 py-1 text-[10px] font-medium rounded-md transition-all",
                chartType === type
                  ? "bg-[#1E1E22] text-white"
                  : "text-[#555] hover:text-white"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Chart area */}
      <div className="relative">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#09090B]/60 backdrop-blur-sm">
            <div className="flex items-center gap-2 text-sm text-[#666]">
              <div className="w-4 h-4 border-2 border-[#3B82F6] border-t-transparent rounded-full animate-spin" />
              Loading...
            </div>
          </div>
        )}
        <div ref={chartRef} className="w-full" />
      </div>
    </div>
  );
}
