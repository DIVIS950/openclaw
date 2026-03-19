"use client";

import { useState } from "react";

interface StockLogoProps {
  src: string;
  ticker: string;
  size?: number;
  className?: string;
}

export function StockLogo({ src, ticker, size = 28, className }: StockLogoProps) {
  const [error, setError] = useState(false);

  if (error) {
    return (
      <div
        className={`flex items-center justify-center text-xs font-bold text-[#555] bg-[#1A1A1E] rounded ${className ?? ""}`}
        style={{ width: size, height: size, fontSize: size * 0.35 }}
      >
        {ticker.slice(0, 2)}
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={ticker}
      width={size}
      height={size}
      className={`object-contain ${className ?? ""}`}
      onError={() => setError(true)}
    />
  );
}
