import { Check, Copy, ExternalLink } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { PLATFORM_META, type ExtensionStatus, type PlatformStatus } from "../../shared/types.ts";
import { hashParams, useApp } from "../App.tsx";
import { Avatar, Button, Card, Label, PlatformLogo, Toggle, TopBar, cx } from "../components/ui.tsx";
import { api, copyText } from "../lib/api.ts";
import { LANGUAGES, REGIONS } from "../lib/regions.ts";

const EBAY_MESSAGES: Record<string, { text: string; ok: boolean }> = {
  connected: { text: "eBay is connected.", ok: true },
  failed: { text: "eBay login didn't finish. Please try again.", ok: false },
  not_configured: { text: "This SnapSell has no eBay app keys yet (see README).", ok: false },
};

/** Account, marketplaces, Chrome extension, price research and selling settings (design artboard 9). */
export function Connections() {
  const { back, me, settings, setSettings, health, signOut } = useApp();
  const [statuses, setStatuses] = useState<PlatformStatus[]>([]);
  const [ext, setExt] = useState<(ExtensionStatus & { paired: boolean }) | null>(null);
  const banner = EBAY_MESSAGES[hashParams().get("ebay") ?? ""];

  const refresh = () => {
    api.platforms().then(setStatuses).catch(() => {});
    api.extension().then(setExt).catch(() => {});
  };
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 10_000);
    return () => clearInterval(t);
  }, []);

  const st = (p: "ebay" | "facebook" | "vinted") => statuses.find((s) => s.platform === p);
  const save = async (patch: Parameters<typeof api.saveSettings>[0]) => setSettings(await api.saveSettings(patch));

  return (
    <div className="pb-16 lg:mx-auto lg:max-w-2xl lg:px-4">
      <TopBar onBack={back} title={<h1 className="font-display text-[28px] font-extrabold">Connections</h1>} />
      <div className="space-y-2.5 px-4">
        {banner && <p className={cx("rounded-2xl px-4 py-3 text-sm font-semibold", banner.ok ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad")}>{banner.text}</p>}

        <Card className="flex items-center gap-3 p-3.5">
          <Avatar name={me.name} picture={me.picture} />
          <div className="min-w-0 flex-1">
            <div className="truncate font-bold">{me.name}</div>
            <div className="truncate text-[13px] text-muted">{me.authEnabled ? `Signed in with Google · ${me.email}` : "Local mode: no login set up"}</div>
          </div>
          {me.authEnabled && (
            <Button variant="outline" size="sm" onClick={signOut}>
              Sign out
            </Button>
          )}
        </Card>

        <div className="px-1 pt-3">
          <Label>Marketplaces</Label>
        </div>
        <Card className="divide-y divide-soft p-0">
          <EbayRow status={st("ebay")} onChange={refresh} />
          {(["facebook", "vinted"] as const).map((p) => {
            const s = st(p);
            return (
              <Row key={p} logo={<PlatformLogo platform={p} size={40} />} title={PLATFORM_META[p].name} detail={s?.detail} ok={s?.connected}>
                {s?.action === "chrome_login" && (
                  <a
                    href={p === "vinted" ? `https://${settings.vintedDomain}/` : "https://www.facebook.com/marketplace"}
                    target="_blank"
                    rel="noreferrer"
                    className="flex h-9 items-center rounded-full bg-ink px-3.5 text-[13px] font-bold text-white"
                  >
                    Log in
                  </a>
                )}
                {s?.action === "install_extension" && (
                  <a href="#extension" className="flex h-9 items-center rounded-full bg-ink px-3.5 text-[13px] font-bold text-white">
                    Set up
                  </a>
                )}
              </Row>
            );
          })}
        </Card>

        <ExtensionCard ext={ext} onPaired={refresh} />

        <div className="px-1 pt-3">
          <Label>Price research</Label>
        </div>
        <Card className="divide-y divide-soft p-0">
          <Row title="Google Lens (Cloud Vision)" detail={health?.lens.vision ? "Finds your item from the photo" : "Add GOOGLE_VISION_API_KEY on the server"} ok={health?.lens.vision} />
          <Row
            title="Google Lens shopping matches (SerpApi)"
            detail={health?.lens.serpapi ? "Real Lens results with shop prices" : "Add SERPAPI_KEY on the server"}
            ok={health?.lens.serpapi}
          />
          <Row title="Sold-price search" detail={health?.ai ? "AI checks eBay, Vinted and more for sold prices" : "Demo mode: add ANTHROPIC_API_KEY"} ok={health?.ai} />
        </Card>

        <div className="px-1 pt-3">
          <Label>Selling</Label>
        </div>
        <Card className="space-y-3">
          <label className="block">
            <span className="text-[13px] font-semibold text-muted">Where you sell</span>
            <select
              value={settings.country}
              onChange={(e) => {
                const r = REGIONS.find((x) => x.country === e.target.value)!;
                void save({ country: r.country, currency: r.currency, language: r.language, vintedDomain: r.vintedDomain });
              }}
              className="mt-1.5 h-12 w-full rounded-xl border-[1.5px] border-line bg-[#faf8f3] px-3 font-semibold"
            >
              {REGIONS.map((r) => (
                <option key={r.country} value={r.country}>
                  {r.country} · {r.currency}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-[13px] font-semibold text-muted">Listings written in</span>
            <select
              value={settings.language}
              onChange={(e) => void save({ language: e.target.value })}
              className="mt-1.5 h-12 w-full rounded-xl border-[1.5px] border-line bg-[#faf8f3] px-3 font-semibold"
            >
              {LANGUAGES.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-3 pt-1">
            <span className="flex-1">
              <span className="block text-[15px] font-bold">Let me check before it goes live</span>
              <span className="block text-[13px] text-muted">Facebook and Vinted wait for your final Publish click. Safer for your accounts.</span>
            </span>
            <Toggle label="Let me check before it goes live" on={!settings.autoPublish} onChange={(on) => void save({ autoPublish: !on })} />
          </div>
        </Card>
      </div>
    </div>
  );
}

function Row({ logo, title, detail, ok, children }: { logo?: ReactNode; title: string; detail?: string; ok?: boolean; children?: ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-3.5 py-3">
      {logo}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-[15px] font-bold">
          {title}
          {ok && <Check className="size-4 text-ok" strokeWidth={3} aria-label="Connected" />}
        </div>
        {detail && <div className={cx("text-[13px]", ok ? "font-semibold text-ok" : "text-muted")}>{detail}</div>}
      </div>
      {children}
    </div>
  );
}

function EbayRow({ status, onChange }: { status?: PlatformStatus; onChange: () => void }) {
  const { settings } = useApp();
  const [postal, setPostal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const code = REGIONS.find((r) => r.country === settings.country)?.code ?? "US";
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <Row logo={<PlatformLogo platform="ebay" size={40} />} title="eBay" detail={status?.detail} ok={status?.connected}>
        {status?.action === "ebay_login" && (
          <a href="/auth/ebay" className="flex h-9 items-center rounded-full bg-ink px-3.5 text-[13px] font-bold text-white">
            Log in with eBay
          </a>
        )}
        {status?.connected && (
          <Button variant="outline" size="sm" onClick={() => run(api.ebayDisconnect)}>
            Disconnect
          </Button>
        )}
      </Row>
      {status?.action === "ebay_setup" && (
        <div className="space-y-2.5 px-3.5 pb-3.5">
          {status.detail.includes("policies") ? (
            <p className="text-[13px] text-muted">
              eBay needs a shipping, a payment and a return policy. Create them once in Seller Hub, then check again.{" "}
              <a href="https://www.ebay.com/sh/ovw" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-ink underline">
                Open Seller Hub <ExternalLink className="size-3" />
              </a>
            </p>
          ) : (
            <div className="flex gap-2">
              <input
                value={postal}
                onChange={(e) => setPostal(e.target.value)}
                placeholder="Postal code you ship from"
                aria-label="Postal code you ship from"
                className="h-11 min-w-0 flex-1 rounded-xl border-[1.5px] border-line bg-[#faf8f3] px-3"
              />
              <Button size="md" className="h-11" loading={busy} onClick={() => run(() => api.ebayLocation(postal, code))}>
                Save
              </Button>
            </div>
          )}
          <Button variant="soft" size="sm" loading={busy} onClick={() => run(api.ebayRefresh)}>
            Check again
          </Button>
          {error && <p className="text-[13px] text-bad">{error}</p>}
        </div>
      )}
    </div>
  );
}

/** The dark "SnapSell for Chrome" card with setup steps and the pairing code. */
function ExtensionCard({ ext, onPaired }: { ext: (ExtensionStatus & { paired: boolean }) | null; onPaired: () => void }) {
  const [pair, setPair] = useState<{ token: string; server: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (text: string, what: string) => {
    if (!(await copyText(text))) return;
    setCopied(what);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <section id="extension" className="scroll-mt-20 rounded-[20px] bg-ink p-4 text-paper">
      <div className="flex items-center gap-3">
        <ChromeMark />
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-bold">SnapSell for Chrome</div>
          <div className="text-[13px] text-[#b9b2a2]">
            {!ext?.paired
              ? "Posts to Facebook and Vinted for you, from your own Chrome"
              : ext.online
                ? "Online · posts to Facebook and Vinted for you"
                : "Offline · open Chrome on your computer"}
          </div>
        </div>
        {ext?.paired && <span className={cx("size-2.5 rounded-full", ext.online ? "bg-[#7bd88f]" : "bg-faint")} aria-label={ext.online ? "Online" : "Offline"} />}
      </div>

      {!ext?.paired && (
        <ol className="mt-4 list-inside list-decimal space-y-1.5 text-sm text-[#d9d3c4]">
          <li>
            In Chrome on your computer open <b className="text-paper">chrome://extensions</b> and turn on Developer mode.
          </li>
          <li>
            Click <b className="text-paper">Load unpacked</b> and choose the <b className="text-paper">apps/snapsell/extension</b> folder.
          </li>
          <li>Create a pairing code below and paste it into the extension.</li>
        </ol>
      )}

      {pair ? (
        <div className="mt-4 space-y-2">
          {[
            ["SnapSell address", pair.server],
            ["Pairing code", pair.token],
          ].map(([label, value]) => (
            <div key={label}>
              <div className="text-xs font-semibold text-[#b9b2a2]">{label}</div>
              <div className="mt-1 flex items-center gap-2 rounded-xl bg-ink-2 px-3 py-2.5">
                <code className="min-w-0 flex-1 truncate text-sm">{value}</code>
                <button onClick={() => copy(value, label)} className="flex items-center gap-1 text-xs font-bold" aria-label={`Copy ${label}`}>
                  {copied === label ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  {copied === label ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          ))}
          <p className="text-xs text-[#b9b2a2]">Anyone with this code can post as you. It replaces any earlier code.</p>
        </div>
      ) : (
        <button
          onClick={async () => {
            setPair(await api.pairExtension());
            onPaired();
          }}
          className="mt-4 h-10 rounded-full bg-paper px-4 text-[13px] font-bold text-ink"
        >
          {ext?.paired ? "Pair again" : "Create pairing code"}
        </button>
      )}
    </section>
  );
}

function ChromeMark() {
  return (
    <span className="grid size-10 shrink-0 place-items-center rounded-full" style={{ background: "conic-gradient(#EA4335 0 33%, #FBBC05 0 66%, #34A853 0)" }} aria-hidden="true">
      <span className="size-4 rounded-full border-[3px] border-white bg-[#4285F4]" />
    </span>
  );
}
