import { Check } from "lucide-react";
import { useState } from "react";
import type { Settings } from "../../shared/types.ts";
import { KeyInput } from "../components/GeminiKey.tsx";
import { Button, Logo, cx } from "../components/ui.tsx";
import { api } from "../lib/api.ts";
import { REGIONS } from "../lib/regions.ts";

/** One-time "where do you sell?" step after sign-in: sets currency, language and Vinted site. */
export function Setup({ settings, onDone, local }: { settings: Settings; onDone: (s: Settings) => void; local?: boolean }) {
  const [key, setKey] = useState(settings.geminiApiKey ?? "");
  const [region, setRegion] = useState(REGIONS.find((r) => r.country === settings.country) ?? REGIONS[2]);
  const [saving, setSaving] = useState(false);

  const start = async () => {
    setSaving(true);
    const { code: _code, ...rest } = region;
    onDone(await api.saveSettings({ ...rest, onboarded: true, ...(local && key.trim() ? { geminiApiKey: key.trim() } : {}) }));
    scrollTo(0, 0);
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col px-6 pb-8 pt-[max(48px,env(safe-area-inset-top))]">
      <Logo size={36} />
      <h1 className="mt-8 font-display text-[34px] font-bold leading-tight">Where do you sell?</h1>
      <p className="mt-2 text-muted">SnapSell prices items in your currency, writes listings in your language and uses your local Vinted.</p>
      <div className="mt-6 grid grid-cols-2 gap-2">
        {REGIONS.map((r) => (
          <button
            key={r.country}
            onClick={() => setRegion(r)}
            aria-pressed={region.country === r.country}
            className={cx(
              "flex h-14 items-center gap-2.5 rounded-2xl border-[1.5px] px-3 text-left text-sm font-semibold transition-colors",
              region.country === r.country ? "border-ink bg-card" : "border-line bg-card/60",
            )}
          >
            <span className="grid h-7 w-9 place-items-center rounded-md bg-soft text-xs font-bold text-muted">{r.code}</span>
            <span className="min-w-0 flex-1 truncate">{r.country}</span>
            {region.country === r.country && <Check className="size-4" strokeWidth={3} />}
          </button>
        ))}
      </div>
      <p className="mt-3 text-sm text-muted">
        Prices in {region.currency}, listings in {region.language}, Vinted: {region.vintedDomain.replace("www.", "")}
      </p>
      {local && (
        <div className="mt-8">
          <h2 className="font-display text-xl font-bold">Your free AI key</h2>
          <div className="mt-2">
            <KeyInput value={key} onChange={setKey} onSave={start} />
          </div>
          <p className="mt-2 text-xs text-muted">You can skip this and try it with sample results first.</p>
        </div>
      )}
      <div className="flex-1" />
      <Button size="lg" className="mt-8 w-full" onClick={start} loading={saving}>
        {local && !key.trim() ? "Continue with sample results" : "Continue"}
      </Button>
    </div>
  );
}
