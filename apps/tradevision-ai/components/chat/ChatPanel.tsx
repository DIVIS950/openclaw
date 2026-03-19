"use client";

import { useState, useRef, useEffect } from "react";
import { X, Send, Zap, Bot, User, RotateCcw } from "lucide-react";
import { cn, generateId, formatTime } from "@/lib/utils";
import type { ChatMessage } from "@/lib/types";

const EXAMPLE_PROMPTS = [
  "Should I buy NVDA right now?",
  "Summarize today's market in 3 bullets",
  "Compare AAPL vs MSFT as investments",
  "Explain why tech stocks are rising",
  "What's the risk with TSLA at this price?",
];

interface ChatPanelProps {
  onClose: () => void;
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";

  return (
    <div className={cn("flex items-start gap-2.5", isUser && "flex-row-reverse")}>
      {/* Avatar */}
      <div
        className={cn(
          "w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5",
          isUser
            ? "bg-[#3B82F6]/20 border border-[#3B82F6]/30"
            : "bg-[#00FF88]/10 border border-[#00FF88]/20"
        )}
      >
        {isUser ? (
          <User size={12} className="text-[#3B82F6]" />
        ) : (
          <Bot size={12} className="text-[#00FF88]" />
        )}
      </div>

      {/* Bubble */}
      <div
        className={cn(
          "max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed",
          isUser
            ? "bg-[#3B82F6]/15 border border-[#3B82F6]/20 text-white"
            : "bg-[#0D0D0F] border border-[#1E1E22] text-[#C0C0C0]"
        )}
      >
        {/* Format code blocks */}
        {message.content.split("```").map((part, i) => {
          if (i % 2 === 1) {
            return (
              <pre
                key={i}
                className="bg-[#09090B] rounded-lg p-2.5 mt-1.5 mb-1.5 overflow-x-auto text-xs font-mono text-[#00FF88] border border-[#1E1E22]"
              >
                {part.trim()}
              </pre>
            );
          }
          return (
            <span key={i} className="whitespace-pre-wrap">
              {part}
            </span>
          );
        })}

        <div className="text-[9px] text-[#444] mt-1 text-right">
          {formatTime(message.timestamp)}
        </div>
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex items-start gap-2.5">
      <div className="w-6 h-6 rounded-full flex items-center justify-center bg-[#00FF88]/10 border border-[#00FF88]/20 flex-shrink-0">
        <Bot size={12} className="text-[#00FF88]" />
      </div>
      <div className="bg-[#0D0D0F] border border-[#1E1E22] rounded-xl px-4 py-3">
        <div className="flex gap-1 items-center h-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="w-1.5 h-1.5 bg-[#555] rounded-full animate-bounce"
              style={{ animationDelay: `${i * 150}ms` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

export function ChatPanel({ onClose }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Hi! I'm TradeVision AI, your personal market analyst. Ask me anything about stocks, market trends, or investment strategies. What would you like to know?",
      timestamp: Date.now(),
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  const sendMessage = async (content: string) => {
    if (!content.trim() || loading) return;

    const userMsg: ChatMessage = {
      id: generateId(),
      role: "user",
      content: content.trim(),
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setLoading(true);
    setStreamingContent("");

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, userMsg].map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });

      if (!res.ok || !res.body) {
        throw new Error("Chat request failed");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split("\n").filter((l) => l.startsWith("data: "));

        for (const line of lines) {
          const data = line.slice(6);
          if (data === "[DONE]") continue;
          try {
            const parsed = JSON.parse(data) as { delta?: string; content?: string };
            const text = parsed.delta ?? parsed.content ?? "";
            fullContent += text;
            setStreamingContent(fullContent);
          } catch {
            fullContent += data;
            setStreamingContent(fullContent);
          }
        }
      }

      const assistantMsg: ChatMessage = {
        id: generateId(),
        role: "assistant",
        content: fullContent || "I'm sorry, I couldn't process that request. Please try again.",
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
      setStreamingContent("");
    } catch {
      const errMsg: ChatMessage = {
        id: generateId(),
        role: "assistant",
        content:
          "I apologize, but I'm having trouble connecting right now. Please make sure your ANTHROPIC_API_KEY is configured in .env.local and try again.",
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, errMsg]);
      setStreamingContent("");
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setMessages([
      {
        id: "welcome",
        role: "assistant",
        content: "Conversation cleared. How can I help you with market analysis?",
        timestamp: Date.now(),
      },
    ]);
  };

  return (
    <div className="fixed bottom-20 right-6 z-50 w-96 h-[580px] flex flex-col rounded-2xl border border-[#2A2A32] shadow-2xl shadow-black/50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[#1E1E22] bg-[#0D0D0F]">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#00FF88]/20 to-[#3B82F6]/20 border border-[#00FF88]/20 flex items-center justify-center">
          <Zap size={14} className="text-[#00FF88]" />
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold text-white">TradeVision AI</div>
          <div className="flex items-center gap-1.5 text-[10px] text-[#555]">
            <div className="w-1.5 h-1.5 rounded-full bg-[#00FF88] animate-pulse" />
            Online
          </div>
        </div>
        <button
          onClick={reset}
          className="text-[#555] hover:text-white transition-colors"
          title="Clear chat"
        >
          <RotateCcw size={14} />
        </button>
        <button
          onClick={onClose}
          className="text-[#555] hover:text-white transition-colors"
        >
          <X size={16} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-[#09090B] scrollbar-hide">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {/* Streaming */}
        {streamingContent && (
          <MessageBubble
            message={{
              id: "streaming",
              role: "assistant",
              content: streamingContent + "▌",
              timestamp: Date.now(),
            }}
          />
        )}

        {loading && !streamingContent && <TypingIndicator />}
        <div ref={bottomRef} />
      </div>

      {/* Example prompts (when only welcome message) */}
      {messages.length === 1 && !loading && (
        <div className="px-4 pb-2 bg-[#09090B]">
          <div className="text-[10px] text-[#444] uppercase tracking-widest mb-2">
            Try asking...
          </div>
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLE_PROMPTS.slice(0, 3).map((prompt) => (
              <button
                key={prompt}
                onClick={() => sendMessage(prompt)}
                className="text-[10px] px-2 py-1 bg-[#111113] border border-[#1E1E22] rounded-lg text-[#666] hover:text-white hover:border-[#333] transition-colors text-left"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="p-3 border-t border-[#1E1E22] bg-[#0D0D0F]">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(e.target.scrollHeight, 100)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage(input);
              }
            }}
            placeholder="Ask about any stock or market..."
            disabled={loading}
            className="flex-1 resize-none bg-[#111113] border border-[#1E1E22] rounded-xl px-3 py-2 text-sm text-white placeholder-[#444] outline-none focus:border-[#3B82F6] transition-colors scrollbar-hide min-h-[38px] max-h-[100px]"
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || loading}
            className={cn(
              "flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-all",
              input.trim() && !loading
                ? "bg-[#3B82F6] text-white hover:bg-[#2563EB]"
                : "bg-[#111113] text-[#444] cursor-not-allowed border border-[#1E1E22]"
            )}
          >
            <Send size={14} />
          </button>
        </div>
        <div className="text-[9px] text-[#333] mt-1.5 text-center">
          Not financial advice · Powered by Claude claude-sonnet-4-6
        </div>
      </div>
    </div>
  );
}
