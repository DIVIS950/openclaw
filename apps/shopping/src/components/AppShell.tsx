"use client";

import { Home, Package, Search, User } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/format";
import { Assistant } from "./Assistant";
import { Avatar, Logo } from "./ui";
import { useUser } from "./Providers";

const TABS = [
  { href: "/", label: "Home", icon: Home },
  { href: "/search", label: "Search", icon: Search },
  { href: "/orders", label: "Parcels", icon: Package },
  { href: "/profile", label: "Profile", icon: User },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const user = useUser();
  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-line/70 bg-bg/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
          <Link href="/" aria-label="Orbit home">
            <Logo />
          </Link>
          <nav className="hidden flex-1 items-center gap-1 md:flex">
            {TABS.slice(0, 3).map((t) => (
              <Link
                key={t.href}
                href={t.href}
                className={cn("rounded-full px-3.5 py-1.5 text-sm font-medium transition", active(t.href) ? "bg-surface-2 text-ink" : "text-muted hover:text-ink")}
              >
                {t.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto">
            {user ? (
              <Link href="/profile" aria-label="Profile">
                <Avatar name={user.name} image={user.image} />
              </Link>
            ) : (
              <Link href="/signin" className="btn btn-primary px-4 py-1.5 text-sm">
                Sign in
              </Link>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-32 pt-4 md:pb-16">{children}</main>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line/70 bg-bg/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden">
        <div className="mx-auto grid max-w-md grid-cols-4">
          {TABS.map((t) => (
            <Link key={t.href} href={t.href} className={cn("flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium", active(t.href) ? "text-ink" : "text-muted")}>
              <t.icon size={21} strokeWidth={active(t.href) ? 2.3 : 1.8} />
              {t.label}
            </Link>
          ))}
        </div>
      </nav>

      <Assistant />
    </div>
  );
}
