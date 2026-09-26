import { Camera, Check, Sparkles, TrendingUp, Send } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { useApp } from "../App.tsx";
import { Button, cx } from "../components/ui.tsx";
import { api } from "../lib/api.ts";
import { REGIONS } from "../lib/regions.ts";

const STEPS = [
  { icon: Camera, title: "Snap a photo", text: "Any item, any light. Up to 12 angles." },
  { icon: Sparkles, title: "AI does the rest", text: "Identifies it, polishes your photos, writes the listing." },
  { icon: TrendingUp, title: "Priced by the market", text: "Live research of real sold listings." },
  { icon: Send, title: "Post everywhere", text: "eBay, Facebook Marketplace and Vinted in one tap." },
];

export function Onboarding() {
  const { settings, setSettings } = useApp();
  const [region, setRegion] = useState(
    REGIONS.find((r) => r.country === settings?.country) ?? REGIONS[0],
  );
  const [saving, setSaving] = useState(false);

  const start = async () => {
    setSaving(true);
    const { flag: _flag, ...rest } = region;
    setSettings(await api.saveSettings({ ...rest, onboarded: true }));
    scrollTo(0, 0);
  };

  return (
    <div className="relative min-h-dvh overflow-hidden px-6 pb-10 pt-[max(48px,env(safe-area-inset-top))]">
      <div className="pointer-events-none absolute -top-40 left-1/2 size-[520px] -translate-x-1/2 rounded-full ai-gradient opacity-25 blur-[120px]" />
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="relative">
        <img src="/icon.svg" alt="" className="size-16 rounded-2xl" />
        <h1 className="mt-6 text-[40px] font-extrabold leading-[1.05] tracking-tight">
          Snap it.
          <br />
          <span className="ai-text">Sell it everywhere.</span>
        </h1>
        <div className="mt-8 space-y-4">
          {STEPS.map((s, i) => (
            <motion.div
              key={s.title}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.15 + i * 0.08 }}
              className="flex items-center gap-4"
            >
              <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-white/5">
                <s.icon className="size-5 text-pink-300" />
              </div>
              <div>
                <div className="font-semibold">{s.title}</div>
                <div className="text-sm text-ink-400">{s.text}</div>
              </div>
            </motion.div>
          ))}
        </div>

        <div className="mt-10 text-sm font-semibold uppercase tracking-wider text-ink-400">Where are you selling?</div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {REGIONS.map((r) => (
            <button
              key={r.country}
              onClick={() => setRegion(r)}
              className={cx(
                "flex items-center gap-2 rounded-2xl border px-3 py-3 text-left text-sm transition-colors",
                region.country === r.country ? "border-pink-400/60 bg-pink-400/10" : "border-white/5 bg-white/[0.03]",
              )}
            >
              <span className="text-xl">{r.flag}</span>
              <span className="flex-1 truncate font-medium">{r.country}</span>
              {region.country === r.country && <Check className="size-4 text-pink-300" />}
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-ink-500">
          Prices in {region.currency}, listings written in {region.language}. You can change this later.
        </p>

        <Button variant="ai" size="lg" className="mt-8 w-full" onClick={start} loading={saving}>
          Get started
        </Button>
      </motion.div>
    </div>
  );
}
