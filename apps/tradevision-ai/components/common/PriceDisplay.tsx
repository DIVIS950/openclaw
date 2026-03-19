"use client";

import { useEffect, useRef, useState } from "react";
import { cn, formatPrice, formatPercent, formatChange, changeTextClass } from "@/lib/utils";

interface PriceDisplayProps {
  price: number;
  change?: number;
  changePercent?: number;
  size?: "sm" | "md" | "lg" | "xl";
  showChange?: boolean;
  className?: string;
}

export function PriceDisplay({
  price,
  change,
  changePercent,
  size = "md",
  showChange = true,
  className,
}: PriceDisplayProps) {
  const prevPrice = useRef(price);
  const [flashClass, setFlashClass] = useState("");

  useEffect(() => {
    if (price !== prevPrice.current) {
      const isUp = price > prevPrice.current;
      setFlashClass(isUp ? "flash-green" : "flash-red");
      prevPrice.current = price;
      const id = setTimeout(() => setFlashClass(""), 600);
      return () => clearTimeout(id);
    }
  }, [price]);

  const sizeClasses = {
    sm: "text-sm",
    md: "text-lg",
    lg: "text-3xl",
    xl: "text-5xl font-bold",
  };

  const changeSizeClasses = {
    sm: "text-xs",
    md: "text-sm",
    lg: "text-base",
    xl: "text-xl",
  };

  const isPositive = (changePercent ?? change ?? 0) >= 0;

  return (
    <div className={cn("flex items-baseline gap-3", className)}>
      <span
        className={cn(
          "num font-semibold text-white rounded transition-colors",
          sizeClasses[size],
          flashClass
        )}
      >
        ${formatPrice(price)}
      </span>
      {showChange && change !== undefined && changePercent !== undefined && (
        <span
          className={cn(
            "num font-medium flex items-center gap-1",
            changeSizeClasses[size],
            changeTextClass(isPositive ? 1 : -1)
          )}
        >
          {isPositive ? "▲" : "▼"}
          {formatChange(Math.abs(change))} ({formatPercent(changePercent)})
        </span>
      )}
    </div>
  );
}
