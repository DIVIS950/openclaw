"use client";

import { useMemo } from "react";

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
  strokeWidth?: number;
}

export function SparklineChart({
  data,
  width = 80,
  height = 32,
  color,
  strokeWidth = 1.5,
}: SparklineProps) {
  const { path, isPositive } = useMemo(() => {
    if (data.length < 2) return { path: "", isPositive: true };

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;

    const points = data.map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - ((v - min) / range) * (height - 4) - 2;
      return [x, y] as [number, number];
    });

    const d = points
      .map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`)
      .join(" ");

    const positive = data[data.length - 1] >= data[0];
    return { path: d, isPositive: positive };
  }, [data, width, height]);

  const lineColor = color ?? (isPositive ? "#00FF88" : "#FF3B5C");
  const glowColor = isPositive ? "rgba(0,255,136,0.4)" : "rgba(255,59,92,0.4)";

  if (!path) return null;

  return (
    <svg width={width} height={height} className="overflow-visible">
      <defs>
        <filter id={`glow-${lineColor.slice(1)}`}>
          <feGaussianBlur stdDeviation="1.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {/* Glow shadow */}
      <path
        d={path}
        fill="none"
        stroke={glowColor}
        strokeWidth={strokeWidth + 2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Main line */}
      <path
        d={path}
        fill="none"
        stroke={lineColor}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
