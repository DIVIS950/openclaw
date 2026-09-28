"use client";

import { ArrowRight, Bike, Bot, Coffee, CookingPot, Footprints, Laptop, Smartphone, Tv, type LucideIcon, Plane, Search, ShieldCheck, Sparkles, Truck, Zap } from "lucide-react";
import { motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { askAI } from "@/components/Assistant";
import { ProductCard } from "@/components/ProductCard";
import { useUser } from "@/components/Providers";
import { SectionTitle } from "@/components/ui";
import { OrbitArt } from "@/components/OrbitArt";
import { getProduct, PRODUCTS } from "@/lib/data";
import { POPULAR } from "@/lib/search";
import { parcelProgress, parcelStatus } from "@/lib/parcels";
import { useAppState } from "@/lib/store";

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export default function Home() {
  const user = useUser();
  const { orders, saved } = useAppState();
  const savedProducts = saved.map((id) => getProduct(id)).filter((p): p is NonNullable<typeof p> => Boolean(p));
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hello, setHello] = useState("Hello");
  useEffect(() => setHello(greeting()), []);

  const active = orders.filter((p) => parcelProgress(p) < 1).slice(0, 3);

  return (
    <div>
      <section className="relative pt-6 md:grid md:grid-cols-[1.4fr_1fr] md:items-center md:gap-8 md:pt-12">
        <div>
        <motion.h1 initial={{ y: 8 }} animate={{ y: 0 }} className="font-serif text-[2.1rem] font-semibold leading-[1.1] tracking-tight md:text-5xl">
          {hello}
          {user ? `, ${user.name.split(" ")[0]}` : ""}.
          <br />
          <span className="text-muted">What can I find for you?</span>
        </motion.h1>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            router.push(`/search?q=${encodeURIComponent(q)}`);
          }}
          className="relative mt-6 max-w-2xl"
        >
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" size={20} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search anything, every shop at once…"
            className="h-14 w-full rounded-full border border-line bg-surface pl-12 pr-32 text-[16px] shadow-[0_8px_30px_-12px_rgba(0,0,0,0.15)] outline-none focus:border-accent"
          />
          <button type="button" onClick={() => askAI(q || undefined)} className="btn btn-accent absolute right-2 top-2 h-10 px-4 text-sm">
            <Sparkles size={16} /> Ask AI
          </button>
        </form>

        <div className="no-scrollbar -mx-4 mt-4 flex gap-2 overflow-x-auto px-4 md:mx-0 md:flex-wrap md:px-0">
          {POPULAR.slice(0, 6).map((c) => (
            <Link key={c} href={`/search?q=${encodeURIComponent(c)}`} className="shrink-0 rounded-full border border-line bg-surface px-3.5 py-1.5 text-sm hover:border-accent">
              {c}
            </Link>
          ))}
        </div>
        </div>
        <OrbitArt />
      </section>

      {active.length > 0 && (
        <>
          <SectionTitle action={<Link href="/orders" className="text-sm text-accent-ink">All parcels</Link>}>On the way</SectionTitle>
          <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4">
            {active.map((p) => {
              const t = parcelProgress(p);
              return (
                <Link key={p.id} href={`/track/${p.id}`} className="card w-72 shrink-0 p-4">
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-accent-ink">
                    {p.mode === "air" ? <Plane size={14} /> : <Truck size={14} />}
                    {parcelStatus(p)}
                  </div>
                  <div className="mt-1.5 truncate font-medium">{p.title}</div>
                  <div className="text-sm text-muted">
                    {p.from.city} → {p.to.city}
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(4, t * 100)}%` }} />
                  </div>
                </Link>
              );
            })}
          </div>
        </>
      )}

      <div className="mt-8 grid gap-3 sm:grid-cols-3">
        {[
          { icon: Zap, title: "Every shop, one search", text: "Prices with delivery to your door, side by side." },
          { icon: ShieldCheck, title: "Scam shield", text: "Each shop gets a trust score before you pay." },
          { icon: Plane, title: "Live parcel map", text: "Watch it fly or drive to you, with an AI arrival time." },
        ].map((f) => (
          <div key={f.title} className="card flex gap-3 p-4">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent-soft text-accent-ink">
              <f.icon size={19} />
            </span>
            <div>
              <div className="font-medium">{f.title}</div>
              <div className="text-sm text-muted">{f.text}</div>
            </div>
          </div>
        ))}
      </div>

      {savedProducts.length > 0 && (
        <>
          <SectionTitle>Saved for later</SectionTitle>
          <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
            {savedProducts.slice(0, 8).map((p, i) => (
              <ProductCard key={p.id} product={p} index={i} />
            ))}
          </div>
        </>
      )}

      <SectionTitle action={<Link href="/search" className="flex items-center gap-1 text-sm text-accent-ink">See all <ArrowRight size={14} /></Link>}>
        Popular right now
      </SectionTitle>
      {process.env.NEXT_PUBLIC_ORBIT_STATIC === "1" ? (
        <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
          {PRODUCTS.map((p, i) => (
            <ProductCard key={p.id} product={p} index={i} />
          ))}
        </div>
      ) : (
        <PopularGrid />
      )}
    </div>
  );
}

const TILES: { q: string; icon: LucideIcon; tint: string }[] = [
  { q: "Running shoes", icon: Footprints, tint: "bg-[#e8ecff] text-[#3150f0]" },
  { q: "iPhone 17 Pro", icon: Smartphone, tint: "bg-[#dff6ec] text-[#0f7a55]" },
  { q: "Robot vacuum", icon: Bot, tint: "bg-[#fde9e4] text-[#c2412d]" },
  { q: "Espresso machine", icon: Coffee, tint: "bg-[#f4ecdf] text-[#8a5a14]" },
  { q: "Gaming laptop", icon: Laptop, tint: "bg-[#ede8fb] text-[#5b3fc4]" },
  { q: "Kids bike", icon: Bike, tint: "bg-[#e3f2fb] text-[#1c6a93]" },
  { q: "Air fryer", icon: CookingPot, tint: "bg-[#fbeee2] text-[#a4521a]" },
  { q: "4K TV 55 inch", icon: Tv, tint: "bg-[#eceef3] text-[#3d4252]" },
];

/** Popular searches as tiles; every one runs a live search. */
function PopularGrid() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {TILES.map((t) => (
        <Link key={t.q} href={`/search?q=${encodeURIComponent(t.q)}`} className="card group flex items-center gap-3 p-4 transition hover:-translate-y-0.5 hover:shadow-[0_10px_24px_-14px_rgba(20,19,28,0.35)]">
          <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${t.tint}`}>
            <t.icon size={21} />
          </span>
          <span className="font-medium leading-tight">{t.q}</span>
        </Link>
      ))}
    </div>
  );
}
