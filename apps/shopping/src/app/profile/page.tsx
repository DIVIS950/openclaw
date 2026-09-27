"use client";

import { Check, CreditCard, Lock, LogOut, Mail, MapPin, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { googleSignOut } from "@/app/actions";
import { useEnv, useUser } from "@/components/Providers";
import { Avatar } from "@/components/ui";
import { PLACES } from "@/lib/geo";
import { setAppState, useAppState, type Address } from "@/lib/store";

export default function ProfilePage() {
  const user = useUser();
  const env = useEnv();
  const { address, card, gmailConnected } = useAppState();
  const [addr, setAddr] = useState<Address>(address);
  const [saved, setSaved] = useState(false);
  useEffect(() => setAddr(address), [address]);

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mt-4 flex items-center gap-4">
        {user ? <Avatar name={user.name} image={user.image} size={60} /> : <span className="h-[60px] w-[60px] rounded-full bg-surface-2" />}
        <div className="flex-1">
          <h1 className="font-serif text-2xl font-semibold">{user?.name ?? "Guest"}</h1>
          <div className="text-sm text-muted">{user ? `${user.email}${user.kind === "demo" ? " · demo account" : ""}` : "Not signed in"}</div>
        </div>
        {user?.kind === "google" ? (
          <form action={googleSignOut}>
            <button className="btn btn-ghost h-10 px-4 text-sm">
              <LogOut size={15} /> Sign out
            </button>
          </form>
        ) : user ? (
          <button onClick={() => setAppState({ demoUser: null })} className="btn btn-ghost h-10 px-4 text-sm">
            <LogOut size={15} /> Sign out
          </button>
        ) : (
          <Link href="/signin" className="btn btn-primary h-10 px-4 text-sm">
            Sign in
          </Link>
        )}
      </div>

      <Section icon={<MapPin size={17} />} title="Delivery address" hint="Filled in automatically at checkout.">
        <div className="grid grid-cols-2 gap-2">
          <input className="field col-span-2" placeholder="Full name" value={addr.name} onChange={(e) => setAddr({ ...addr, name: e.target.value })} />
          <input className="field col-span-2" placeholder="Street and number" value={addr.line1} onChange={(e) => setAddr({ ...addr, line1: e.target.value })} />
          <select className="field" value={addr.city} onChange={(e) => setAddr({ ...addr, city: e.target.value })} aria-label="City">
            {PLACES.map((p) => (
              <option key={p.city}>{p.city}</option>
            ))}
          </select>
          <input className="field" placeholder="Postcode" value={addr.zip} onChange={(e) => setAddr({ ...addr, zip: e.target.value })} />
          <input className="field col-span-2" placeholder="Phone" value={addr.phone} onChange={(e) => setAddr({ ...addr, phone: e.target.value })} />
        </div>
        <button
          onClick={() => {
            setAppState({ address: addr });
            setSaved(true);
            setTimeout(() => setSaved(false), 1500);
          }}
          className="btn btn-primary mt-3 h-10 px-5 text-sm"
        >
          {saved ? <><Check size={15} /> Saved</> : "Save address"}
        </button>
      </Section>

      <Section icon={<CreditCard size={17} />} title="Payment" hint="Only the card brand and last 4 digits are stored.">
        {card ? (
          <div className="flex items-center gap-3">
            <span className="grid h-9 w-14 place-items-center rounded-md bg-ink text-[10px] font-bold text-bg">{card.brand.toUpperCase()}</span>
            <span className="flex-1">
              •••• {card.last4} <span className="text-sm text-muted">· exp {card.exp}</span>
            </span>
            <button onClick={() => setAppState({ card: null })} className="btn btn-ghost h-9 w-9" aria-label="Remove card">
              <Trash2 size={15} />
            </button>
          </div>
        ) : (
          <p className="text-sm text-muted">No saved card yet — you'll add one at your first checkout.</p>
        )}
      </Section>

      <Section icon={<Sparkles size={17} />} title="Connected services">
        <Service name="Google account" on={user?.kind === "google"} detail={env.googleEnabled ? "Sign in with Google" : "Needs AUTH_GOOGLE_ID"} />
        <Service name="Gmail parcel tracking" on={gmailConnected} detail={env.gmailEnabled ? "Read-only access to shipping emails" : "Demo parcels (set ORBIT_GMAIL=1)"} icon={<Mail size={14} />} />
        <Service name="Claude AI" on={env.aiEnabled} detail={env.aiEnabled ? "Live prices, scam checks and ETAs" : "Demo answers (set ANTHROPIC_API_KEY)"} />
      </Section>

      <Section icon={<Lock size={17} />} title="Security">
        <ul className="space-y-1.5 text-sm text-muted">
          <li>• Google sign-in only — Orbit never sees your password.</li>
          <li>• Card numbers and CVC are never stored; payments go through a PCI-compliant processor.</li>
          <li>• Gmail access is read-only and stays on the server, never in your browser.</li>
          <li>• Every shop is scam-checked before you can pay.</li>
        </ul>
      </Section>
    </div>
  );
}

function Section({ icon, title, hint, children }: { icon: React.ReactNode; title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="card mt-4 p-5">
      <h2 className="flex items-center gap-2 font-semibold">
        <span className="text-accent">{icon}</span>
        {title}
      </h2>
      {hint && <p className="mb-3 mt-0.5 text-sm text-muted">{hint}</p>}
      <div className={hint ? "" : "mt-3"}>{children}</div>
    </section>
  );
}

function Service({ name, on, detail, icon }: { name: string; on: boolean; detail: string; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 border-b border-line py-2.5 last:border-0">
      <span className={`h-2.5 w-2.5 rounded-full ${on ? "bg-ok" : "bg-line"}`} />
      <div className="flex-1">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          {icon}
          {name}
        </div>
        <div className="text-xs text-muted">{detail}</div>
      </div>
      <span className={`text-xs font-semibold ${on ? "text-ok" : "text-muted"}`}>{on ? "On" : "Off"}</span>
    </div>
  );
}
