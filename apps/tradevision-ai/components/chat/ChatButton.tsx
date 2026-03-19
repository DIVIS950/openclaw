"use client";

import { useState } from "react";
import { MessageCircle, X } from "lucide-react";
import { ChatPanel } from "./ChatPanel";
import { cn } from "@/lib/utils";

export function ChatButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {open && <ChatPanel onClose={() => setOpen(false)} />}

      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full shadow-2xl",
          "flex items-center justify-center transition-all duration-300",
          "border focus:outline-none",
          open
            ? "bg-[#FF3B5C] border-[#FF3B5C]/50 shadow-[#FF3B5C]/30"
            : "bg-gradient-to-br from-[#00FF88] to-[#3B82F6] border-transparent shadow-[#00FF88]/30",
          "hover:scale-110 active:scale-95"
        )}
        style={{
          boxShadow: open
            ? "0 0 20px rgba(255,59,92,0.3), 0 8px 32px rgba(0,0,0,0.5)"
            : "0 0 20px rgba(0,255,136,0.3), 0 8px 32px rgba(0,0,0,0.5)",
        }}
        aria-label="Open AI chat"
      >
        {open ? (
          <X size={22} className="text-white" />
        ) : (
          <MessageCircle size={22} className="text-[#09090B]" strokeWidth={2.5} />
        )}
      </button>
    </>
  );
}
