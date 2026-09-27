"use client";

import { ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { googleSignIn } from "@/app/actions";
import { useEnv } from "@/components/Providers";
import { Logo } from "@/components/ui";
import { setAppState } from "@/lib/store";

export default function SignInPage() {
  const { googleEnabled } = useEnv();
  const router = useRouter();
  const [name, setName] = useState("");

  return (
    <div className="mx-auto max-w-sm pt-10 text-center">
      <div className="flex justify-center">
        <Logo />
      </div>
      <h1 className="mt-8 font-serif text-3xl font-semibold tracking-tight">Shop everything, safely.</h1>
      <p className="mt-2 text-muted">Sign in to save your address, pay in one tap and track every parcel.</p>

      {googleEnabled ? (
        <form action={googleSignIn} className="mt-8">
          <button className="btn h-12 w-full border border-line bg-surface text-ink hover:border-muted">
            <GoogleG /> Continue with Google
          </button>
        </form>
      ) : (
        <div className="mt-8 space-y-2 text-left">
          <button disabled className="btn h-12 w-full border border-line bg-surface text-muted opacity-60">
            <GoogleG /> Continue with Google
          </button>
          <p className="text-center text-xs text-muted">Google sign-in turns on once AUTH_GOOGLE_ID is set.</p>
          <div className="pt-4">
            <input className="field" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} />
            <button
              onClick={() => {
                const n = name.trim() || "Guest";
                setAppState((s) => ({ demoUser: { name: n, email: `${n.toLowerCase().replace(/\s+/g, ".")}@demo.orbit` }, address: { ...s.address, name: s.address.name || n } }));
                router.push("/");
              }}
              className="btn btn-primary mt-2 h-12 w-full"
            >
              Try the demo
            </button>
          </div>
        </div>
      )}
      <p className="mt-6 flex items-center justify-center gap-1.5 text-xs text-muted">
        <ShieldCheck size={13} /> We never see your Google password.
      </p>
    </div>
  );
}

function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
