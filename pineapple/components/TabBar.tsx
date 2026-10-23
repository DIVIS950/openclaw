"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const tabs = [
  {
    href: "/",
    label: "Order",
    match: (p: string) => p === "/" || p.startsWith("/orders"),
    icon: (
      <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z" />
    ),
  },
  {
    href: "/history",
    label: "History",
    match: (p: string) => p.startsWith("/history"),
    icon: (
      <>
        <circle cx="12" cy="12" r="9" fill="none" strokeWidth="2" stroke="currentColor" />
        <path d="M12 7v5l3.5 2" fill="none" strokeWidth="2" stroke="currentColor" strokeLinecap="round" />
      </>
    ),
  },
  {
    href: "/settings",
    label: "Settings",
    match: (p: string) => p.startsWith("/settings"),
    icon: (
      <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <path d="M4 7h9M19 7h1M4 17h3M13 17h7" />
        <circle cx="16" cy="7" r="2.5" />
        <circle cx="10" cy="17" r="2.5" />
      </g>
    ),
  },
];

export function TabBar() {
  const pathname = usePathname();
  return (
    <nav className="tabbar" aria-label="Main">
      {tabs.map((tab) => {
        const active = tab.match(pathname);
        return (
          <Link key={tab.href} href={tab.href} className={active ? "tab tab-active" : "tab"} aria-current={active ? "page" : undefined}>
            <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor" aria-hidden="true">
              {tab.icon}
            </svg>
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
