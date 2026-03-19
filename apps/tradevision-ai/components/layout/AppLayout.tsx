"use client";

import { useState } from "react";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { ChatButton } from "@/components/chat/ChatButton";
import { cn } from "@/lib/utils";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  return (
    <div className="min-h-screen bg-[#09090B]">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((v) => !v)}
      />
      <TopBar sidebarCollapsed={sidebarCollapsed} />

      {/* Main content */}
      <main
        className={cn(
          "transition-all duration-300 min-h-screen",
          sidebarCollapsed ? "ml-16" : "ml-56",
          "pt-[57px]" // TopBar height
        )}
      >
        <div className="p-6 animate-fade-in-up">{children}</div>
      </main>

      {/* Floating AI Chat */}
      <ChatButton />
    </div>
  );
}
