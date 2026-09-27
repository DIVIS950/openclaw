"use client";

import { Heart } from "lucide-react";
import { motion } from "motion/react";
import { cn } from "@/lib/format";
import { setAppState, useAppState } from "@/lib/store";

export function SaveButton({ productId }: { productId: string }) {
  const { saved } = useAppState();
  const on = saved.includes(productId);
  return (
    <motion.button
      whileTap={{ scale: 0.85 }}
      onClick={() => setAppState((s) => ({ saved: on ? s.saved.filter((id) => id !== productId) : [productId, ...s.saved].slice(0, 40) }))}
      className={cn("btn h-10 w-10 shrink-0 border", on ? "border-accent bg-accent-soft text-accent" : "border-line bg-surface text-muted")}
      aria-label={on ? "Remove from saved" : "Save for later"}
      aria-pressed={on}
    >
      <Heart size={18} fill={on ? "currentColor" : "none"} />
    </motion.button>
  );
}
