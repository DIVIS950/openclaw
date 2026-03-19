"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Search,
  Newspaper,
  Star,
  Briefcase,
  ChevronLeft,
  ChevronRight,
  Zap,
  TrendingUp,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", icon: BarChart3, label: "Dashboard" },
  { href: "/stocks", icon: Search, label: "Stocks" },
  { href: "/news", icon: Newspaper, label: "News Feed" },
  { href: "/watchlist", icon: Star, label: "Watchlist" },
  { href: "/portfolio", icon: Briefcase, label: "Portfolio" },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        "fixed left-0 top-0 bottom-0 z-30 flex flex-col transition-all duration-300 ease-in-out",
        "border-r border-[#1E1E22] bg-[#0D0D0F]",
        collapsed ? "w-16" : "w-56"
      )}
    >
      {/* Logo */}
      <div
        className={cn(
          "flex items-center gap-3 px-4 py-5 border-b border-[#1E1E22]",
          collapsed && "justify-center px-0"
        )}
      >
        <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-gradient-to-br from-[#00FF88] to-[#00BFFF] flex items-center justify-center shadow-lg shadow-[#00FF88]/20">
          <TrendingUp size={16} className="text-[#09090B] font-bold" strokeWidth={2.5} />
        </div>
        {!collapsed && (
          <div className="overflow-hidden">
            <span className="block text-sm font-bold text-white tracking-tight whitespace-nowrap">
              TradeVision
            </span>
            <span className="block text-[10px] font-medium text-[#00FF88] tracking-widest uppercase">
              AI
            </span>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 px-2 space-y-1">
        {NAV_ITEMS.map(({ href, icon: Icon, label }) => {
          const isActive =
            href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "group flex items-center gap-3 rounded-lg transition-all duration-150",
                collapsed ? "justify-center p-3" : "px-3 py-2.5",
                isActive
                  ? "bg-[#00FF88]/10 text-[#00FF88]"
                  : "text-[#888] hover:text-white hover:bg-white/5"
              )}
              title={collapsed ? label : undefined}
            >
              <Icon
                size={18}
                className={cn(
                  "flex-shrink-0 transition-transform duration-150",
                  isActive && "drop-shadow-[0_0_8px_rgba(0,255,136,0.6)]",
                  "group-hover:scale-110"
                )}
              />
              {!collapsed && (
                <span
                  className={cn(
                    "text-sm font-medium whitespace-nowrap transition-opacity",
                    isActive ? "text-[#00FF88]" : "text-inherit"
                  )}
                >
                  {label}
                </span>
              )}
              {/* Active indicator */}
              {isActive && (
                <div
                  className={cn(
                    "absolute left-0 w-0.5 h-6 bg-[#00FF88] rounded-r-full shadow-[0_0_8px_rgba(0,255,136,0.8)]",
                    collapsed ? "left-0" : "left-0"
                  )}
                />
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="py-4 px-2 border-t border-[#1E1E22] space-y-1">
        {!collapsed && (
          <div className="px-3 mb-3">
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-[#00FF88]/5 border border-[#00FF88]/20">
              <Zap size={12} className="text-[#00FF88]" />
              <span className="text-[10px] text-[#00FF88] font-medium tracking-wide">
                AI Signals Active
              </span>
            </div>
          </div>
        )}
        <button
          onClick={onToggle}
          className={cn(
            "w-full flex items-center gap-3 rounded-lg text-[#666] hover:text-white hover:bg-white/5 transition-all duration-150",
            collapsed ? "justify-center p-3" : "px-3 py-2.5"
          )}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? (
            <ChevronRight size={16} />
          ) : (
            <>
              <ChevronLeft size={16} />
              <span className="text-xs">Collapse</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
