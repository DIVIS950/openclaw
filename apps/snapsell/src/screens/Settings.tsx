import { Check, Cpu, Loader2, LogOut, Plug } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { PLATFORMS, PLATFORM_META, type Platform, type PlatformStatus, type Settings } from "../../shared/types.ts";
import { useApp } from "../App.tsx";
import { Label, PlatformLogo, TopBar, Toggle, cx } from "../components/ui.tsx";
import { api } from "../lib/api.ts";
import { LANGUAGES, REGIONS } from "../lib/regions.ts";

export function SettingsScreen() {
  const { back, settings, setSettings } = useApp();
  const [statuses, setStatuses] = useState<PlatformStatus[]>([]);
  const [connecting, setConnecting] = useState<Platform | null>(null);
  const [health, setHealth] = useState<{ ai: boolean; model: string } | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const refresh = () => api.platforms().then(setStatuses);
  useEffect(() => {
    void refresh();
    api.health().then(setHealth);
    return () => clearInterval(poll.current);
  }, []);

  const save = async (patch: Partial<Settings>) => setSettings(await api.saveSettings(patch));

  const connect = async (p: Platform) => {
    setConnecting(p);
    await api.connect(p);
    // A browser window opens on the computer running SnapSell; wait for the login to land.
    clearInterval(poll.current);
    const started = Date.now();
    poll.current = setInterval(async () => {
      const s = await api.platforms();
      setStatuses(s);
      if (s.find((x) => x.platform === p)?.connected || Date.now() - started > 5 * 60_000) {
        clearInterval(poll.current);
        setConnecting(null);
      }
    }, 2000);
  };

  const s = settings!;
  return (
    <div className="pb-16">
      <TopBar title="Settings" onBack={back} />
      <div className="space-y-6 px-5">
        <section>
          <Label>Marketplaces</Label>
          <div className="card divide-y divide-white/5">
            {PLATFORMS.map((p) => {
              const st = statuses.find((x) => x.platform === p);
              return (
                <div key={p} className="flex items-center gap-3 p-4">
                  <PlatformLogo platform={p} size={40} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 font-semibold">
                      {PLATFORM_META[p].name}
                      {st?.connected && <Check className="size-4 text-emerald-400" />}
                    </div>
                    <div className="text-xs text-ink-400">{st?.detail ?? "…"}</div>
                  </div>
                  {st?.mode === "browser" &&
                    (st.connected ? (
                      <button
                        onClick={() => api.disconnect(p).then(refresh)}
                        className="grid size-9 place-items-center rounded-full bg-white/5 text-ink-400"
                        aria-label="Disconnect"
                      >
                        <LogOut className="size-4" />
                      </button>
                    ) : (
                      <button
                        onClick={() => connect(p)}
                        disabled={connecting === p}
                        className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-2 text-xs font-bold text-ink-950"
                      >
                        {connecting === p ? <Loader2 className="size-3.5 animate-spin" /> : <Plug className="size-3.5" />}
                        {connecting === p ? "Log in in the window" : "Connect"}
                      </button>
                    ))}
                </div>
              );
            })}
          </div>
          <p className="mt-2 px-1 text-xs text-ink-500">
            Connect opens a browser window on the computer running SnapSell. Log in normally; SnapSell remembers the session.
            eBay uses its official API, set up once in <code>.env</code> (see README).
          </p>
        </section>

        <section>
          <Label>Posting</Label>
          <div className="card flex items-center gap-3 p-4">
            <div className="flex-1">
              <div className="font-semibold">Auto-publish</div>
              <div className="text-xs text-ink-400">
                Off: SnapSell fills everything in and you press the final Publish button. Safer for your accounts.
              </div>
            </div>
            <Toggle on={s.autoPublish} onChange={(v) => save({ autoPublish: v })} />
          </div>
        </section>

        <section>
          <Label>Region</Label>
          <div className="grid grid-cols-2 gap-2">
            {REGIONS.map((r) => (
              <button
                key={r.country}
                onClick={() => save({ country: r.country, currency: r.currency, language: r.language, vintedDomain: r.vintedDomain })}
                className={cx(
                  "flex items-center gap-2 rounded-2xl border px-3 py-2.5 text-left text-sm",
                  s.country === r.country ? "border-pink-400/60 bg-pink-400/10" : "border-white/5 bg-white/[0.03]",
                )}
              >
                <span className="text-lg">{r.flag}</span>
                <span className="flex-1 truncate">{r.country}</span>
                <span className="text-xs text-ink-500">{r.currency}</span>
              </button>
            ))}
          </div>
        </section>

        <section>
          <Label>Listing language</Label>
          <div className="flex flex-wrap gap-2">
            {LANGUAGES.map((l) => (
              <button
                key={l}
                onClick={() => save({ language: l })}
                className={cx("rounded-full px-3.5 py-2 text-sm", s.language === l ? "bg-white font-semibold text-ink-950" : "bg-white/5")}
              >
                {l}
              </button>
            ))}
          </div>
        </section>

        <section>
          <Label>AI</Label>
          <div className="card flex items-center gap-3 p-4">
            <div className="grid size-10 place-items-center rounded-xl ai-gradient">
              <Cpu className="size-5" />
            </div>
            <div className="flex-1">
              <div className="font-semibold">{health?.ai ? "Claude connected" : "Demo mode"}</div>
              <div className="text-xs text-ink-400">
                {health?.ai ? `Model ${health.model} · vision + live web research` : "Set ANTHROPIC_API_KEY in .env and restart"}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
