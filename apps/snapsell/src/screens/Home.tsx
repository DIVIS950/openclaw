import { AlertTriangle, Camera, Loader2 } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { PLATFORMS, PLATFORM_META, effectivePrice, type Listing } from "../../shared/types.ts";
import { useApp } from "../App.tsx";
import { ItemArt } from "../components/ItemArt.tsx";
import { Avatar, PlatformLogo, Segmented, cx } from "../components/ui.tsx";
import { api, formatPrice, pendingPhotos, photoUrl } from "../lib/api.ts";

type Filter = "all" | "live" | "draft" | "sold";

function stats(all: Listing[]) {
  const now = new Date();
  const sold = all.filter((l) => l.status === "sold");
  const soldThisMonth = sold.filter((l) => {
    const d = new Date(l.soldAt ?? l.updatedAt);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  const live = all.filter((l) => l.status === "live");
  const days = sold
    .filter((l) => l.soldAt)
    .map((l) => (Date.parse(l.soldAt!) - Date.parse(l.createdAt)) / 86_400_000);
  return {
    earned: soldThisMonth.reduce((s, l) => s + effectivePrice(l), 0),
    soldCount: soldThisMonth.length,
    live: live.length,
    listedValue: live.reduce((s, l) => s + effectivePrice(l), 0),
    avgDays: days.length ? Math.max(1, Math.round(days.reduce((a, b) => a + b, 0) / days.length)) : null,
  };
}

const livePlatforms = (l: Listing) => PLATFORMS.filter((p) => l.publish[p]?.status === "live");

export function Home() {
  const { go, me, settings, health } = useApp();
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    api.listings().then(setListings).catch(() => setListings([]));
  }, []);

  const all = listings ?? [];
  const st = stats(all);
  const counts = {
    all: all.length,
    live: all.filter((l) => l.status === "live").length,
    draft: all.filter((l) => l.status === "draft").length,
    sold: all.filter((l) => l.status === "sold").length,
  };
  const shown = filter === "all" ? all : all.filter((l) => l.status === filter);
  const cur = settings.currency;
  const month = new Date().toLocaleString(undefined, { month: "long" });

  const statsCard = (
    <div className="rounded-[16px] bg-card p-4">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[13px] font-medium text-muted">Earned in {month}</div>
          <div className="mt-0.5 font-display text-[34px] font-bold leading-tight tabular-nums">{formatPrice(st.earned, cur)}</div>
        </div>
        {st.soldCount > 0 && <span className="rounded-full bg-ok-soft px-2.5 py-1 text-[13px] font-semibold text-ok">+{st.soldCount} sold</span>}
      </div>
      <div className="mt-3 grid grid-cols-3 divide-x divide-line border-t border-line pt-3">
        {[
          [String(st.live), "Live"],
          [formatPrice(st.listedValue, cur), "Listed value"],
          [st.avgDays ? `${st.avgDays} day${st.avgDays > 1 ? "s" : ""}` : "—", "Avg. to sell"],
        ].map(([v, l]) => (
          <div key={l} className="min-w-0 px-3 first:pl-0">
            <div className="truncate text-[17px] font-semibold tabular-nums">{v}</div>
            <div className="text-[12px] text-muted">{l}</div>
          </div>
        ))}
      </div>
    </div>
  );

  const filters = (
    <Segmented
      label="Filter listings"
      value={filter}
      onChange={setFilter}
      options={(["all", "live", "draft", "sold"] as const).map((f) => ({
        id: f,
        label: `${{ all: "All", live: "Live", draft: "Drafts", sold: "Sold" }[f]}${counts[f] ? ` ${counts[f]}` : ""}`,
      }))}
    />
  );

  const demoBanner = health?.demo && (
    <div className="flex items-start gap-3 rounded-2xl bg-warn-soft p-3 text-sm text-warn">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      {health.preview ? (
        <span>Web preview: sample data and demo AI results. Your photos stay in this browser tab.</span>
      ) : health.hosted ? (
        <span>Sample results: open SnapSell on claude.ai so Claude can analyze your photos.</span>
      ) : health.local ? (
        <span>
          Sample results for now. <a href="#/connections" className="font-bold underline">Add your free Gemini key</a> to analyze your real photos.
        </span>
      ) : (
        <span>
          Demo mode: add your Anthropic API key to <code className="font-mono">.env</code> to analyze real photos.
        </span>
      )}
    </div>
  );

  return (
    <>
      {/* ---------- phone ---------- */}
      <div className="relative min-h-dvh pb-36 lg:hidden">
        <header className="flex items-end justify-between px-5 pt-[max(24px,env(safe-area-inset-top))]">
          <div>
            <div className="text-[13px] font-semibold uppercase tracking-[0.02em] text-muted">{new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</div>
            <h1 className="font-display text-[34px] font-bold leading-tight">Listings</h1>
          </div>
          <button onClick={() => go("/connections")} aria-label="Account and settings" className="mb-1 rounded-full">
            <Avatar name={me.name} picture={me.picture} size={36} />
          </button>
        </header>
        <div className="mt-5 space-y-4 px-5">
          {demoBanner}
          {statsCard}
        </div>
        {all.length > 0 && <div className="mt-4 px-5">{filters}</div>}
        {listings === null ? (
          <div className="mt-4 grid grid-cols-2 gap-3 px-5">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="shimmer h-[220px] rounded-[16px]" />
            ))}
          </div>
        ) : all.length === 0 ? (
          <Empty onStart={() => go("/new")} />
        ) : (
          <div className="mt-3.5 grid grid-cols-2 gap-3 px-5">
            {shown.map((l, i) => (
              <ListingCard key={l.id} listing={l} index={i} onOpen={() => go(`/l/${l.id}`)} />
            ))}
          </div>
        )}
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 mx-auto max-w-lg bg-gradient-to-b from-paper/0 via-paper/85 to-paper px-5 pt-8 safe-bottom">
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={() => go("/new")}
            className="pointer-events-auto flex h-[54px] w-full items-center justify-center gap-2.5 rounded-[16px] bg-accent text-[17px] font-semibold text-white shadow-[0_10px_30px_-10px_rgba(0,98,224,0.6)]"
          >
            <Camera className="size-[22px]" /> Snap &amp; sell
          </motion.button>
        </div>
      </div>

      {/* ---------- desktop ---------- */}
      <div className="hidden flex-col gap-5 px-8 py-7 lg:flex">
        <div className="flex items-center gap-3">
          <h1 className="flex-1 font-display text-[32px] font-bold">Listings</h1>
          <button onClick={() => go("/new")} className="h-11 rounded-xl bg-accent px-[18px] text-[15px] font-bold text-white">
            New listing
          </button>
        </div>
        {demoBanner}
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-[16px] bg-card px-5 py-[18px]">
            <div className="text-[13px] text-muted">Earned in {month}</div>
            <div className="mt-1 font-display text-[32px] font-bold">{formatPrice(st.earned, cur)}</div>
          </div>
          <div className="rounded-[14px] bg-card px-5 py-[18px]">
            <div className="text-[13px] text-muted">Live listings value</div>
            <div className="mt-1 font-display text-[32px] font-bold">{formatPrice(st.listedValue, cur)}</div>
          </div>
          <div className="rounded-[14px] bg-card px-5 py-[18px]">
            <div className="text-[13px] text-muted">Average time to sell</div>
            <div className="mt-1 font-display text-[32px] font-bold">{st.avgDays ? `${st.avgDays} days` : "—"}</div>
          </div>
        </div>
        {all.length > 0 && filters}
        <div className="flex gap-5">
          <div className="min-w-0 flex-1 overflow-hidden rounded-[16px] bg-card">
            <table className="w-full table-fixed text-left">
              <colgroup>
                <col />
                <col className="w-[110px]" />
                <col className="w-[170px]" />
                <col className="w-[110px]" />
              </colgroup>
              <thead>
                <tr className="border-b border-soft text-xs font-bold uppercase tracking-[0.08em] text-muted">
                  <th className="px-5 py-3 font-bold">Item</th>
                  <th className="py-3 font-bold">Price</th>
                  <th className="py-3 font-bold">Marketplaces</th>
                  <th className="py-3 pr-5 font-bold">Status</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((l) => (
                  <tr key={l.id} onClick={() => go(`/l/${l.id}`)} className="cursor-pointer border-b border-soft last:border-0 hover:bg-paper/60">
                    <td className="px-5 py-3">
                      <a href={`#/l/${l.id}`} className="flex min-w-0 items-center gap-3">
                        <img src={photoUrl(l, 0)} alt="" className="size-12 shrink-0 rounded-xl bg-soft object-cover" />
                        <span className="min-w-0">
                          <span className="block truncate text-[15px] font-semibold">{title(l)}</span>
                          <span className="block text-[13px] text-muted">{subtitle(l)}</span>
                        </span>
                      </a>
                    </td>
                    <td className="py-3 text-[15px] font-bold">{l.analysis ? formatPrice(effectivePrice(l), l.analysis.price.currency) : "—"}</td>
                    <td className="py-3 text-sm">
                      {livePlatforms(l).map((p) => PLATFORM_META[p].name.split(" ")[0]).join(", ") || <span className="text-muted">Not posted</span>}
                    </td>
                    <td className="py-3 pr-5">
                      <StatusPill l={l} />
                    </td>
                  </tr>
                ))}
                {listings && shown.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-5 py-10 text-center text-muted">
                      No listings here yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <DropZone />
        </div>
      </div>
    </>
  );
}

const title = (l: Listing) => l.edits.title ?? l.analysis?.title ?? (l.status === "failed" ? "Analysis failed" : "Analyzing…");

function subtitle(l: Listing) {
  const days = Math.floor((Date.now() - Date.parse(l.createdAt)) / 86_400_000);
  const when = days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
  if (l.status === "draft") return "Draft · priced by AI";
  if (l.status === "sold") return "Sold";
  return `Added ${when}`;
}

function StatusPill({ l }: { l: Listing }) {
  return (
    <span
      className={cx(
        "inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-[12px] font-semibold backdrop-blur-md",
        l.status === "live" && "bg-[#34c759]/90 text-white",
        l.status === "draft" && "bg-white/85 text-ink",
        l.status === "sold" && "bg-black/70 text-white",
        l.status === "failed" && "bg-bad/90 text-white",
        l.status === "analyzing" && "bg-white/85 text-ink",
      )}
    >
      {l.status === "analyzing" && <Loader2 className="size-3 animate-spin" />}
      {{ live: "Live", draft: "Draft", sold: "Sold", failed: "Failed", analyzing: "Analyzing" }[l.status]}
    </span>
  );
}

function ListingCard({ listing: l, index, onOpen }: { listing: Listing; index: number; onOpen: () => void }) {
  return (
    <motion.button
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 8) * 0.04 }}
      whileTap={{ scale: 0.97 }}
      onClick={onOpen}
      className="overflow-hidden rounded-[16px] bg-card text-left"
    >
      <div className="relative aspect-square overflow-hidden bg-soft">
        {l.photos[0] && <img src={photoUrl(l, 0)} alt="" className="size-full object-cover" loading="lazy" />}
        <span className="absolute left-2 top-2">
          <StatusPill l={l} />
        </span>
      </div>
      <div className="px-3 pb-3 pt-2.5">
        <div className="line-clamp-2 text-[14px] font-medium leading-snug">{title(l)}</div>
        <div className="mt-1.5 flex items-center justify-between">
          <span className="font-display text-[17px] font-semibold tabular-nums">{l.analysis ? formatPrice(effectivePrice(l), l.analysis.price.currency) : "—"}</span>
          <span className="flex gap-[3px]">
            {livePlatforms(l).map((p) => (
              <PlatformLogo key={p} platform={p} size={18} />
            ))}
          </span>
        </div>
      </div>
    </motion.button>
  );
}

function Empty({ onStart }: { onStart: () => void }) {
  return (
    <div className="mt-10 flex flex-col items-center px-10 text-center">
      <button onClick={onStart} className="grid size-32 place-items-center rounded-[30px] bg-card shadow-sm" aria-label="Snap your first item">
        <ItemArt kind="camera" size={96} />
      </button>
      <h2 className="mt-6 font-display text-[22px] font-bold">Turn stuff into money</h2>
      <p className="mt-2 text-muted">Snap anything you want to sell. AI finds what it is, prices it from real sold listings and writes the listing.</p>
    </div>
  );
}

/** Desktop: drop photos to start a listing (design artboard 11). */
function DropZone() {
  const { go } = useApp();
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const start = (files: FileList | null) => {
    const imgs = [...(files ?? [])].filter((f) => f.type.startsWith("image/"));
    if (!imgs.length) return;
    pendingPhotos.files = imgs;
    go("/new");
  };
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        start(e.dataTransfer.files);
      }}
      className={cx(
        "flex w-[300px] shrink-0 flex-col items-center justify-center self-start rounded-[20px] border-2 border-dashed p-6 py-12 text-center transition-colors",
        over ? "border-accent bg-accent/5" : "border-line-strong",
      )}
    >
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => start(e.target.files)} />
      <button onClick={() => input.current?.click()} className="grid size-16 place-items-center rounded-[20px] bg-accent" aria-label="Choose photos">
        <Camera className="size-7 text-white" />
      </button>
      <div className="mt-4 font-display text-[22px] font-bold">Drop photos here</div>
      <p className="mt-1.5 text-sm leading-relaxed text-muted">AI identifies the item, prices it and writes the listing. Or snap it on your phone, it shows up here.</p>
    </div>
  );
}
