"use client";

import { useState } from "react";
import type { CompanyProfile as Profile } from "@/lib/types";
import { ChevronDown, ChevronUp, Globe, MapPin, Users, Calendar } from "lucide-react";

export function CompanyProfile({ profile }: { profile: Profile }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="glass rounded-xl border border-[#1E1E22] p-4">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full mb-3"
      >
        <h3 className="text-xs font-semibold text-[#666] uppercase tracking-widest">
          About {profile.name}
        </h3>
        {expanded ? (
          <ChevronUp size={14} className="text-[#444]" />
        ) : (
          <ChevronDown size={14} className="text-[#444]" />
        )}
      </button>

      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="flex items-center gap-2">
          <MapPin size={12} className="text-[#555]" />
          <span className="text-xs text-[#777]">{profile.headquarters}</span>
        </div>
        <div className="flex items-center gap-2">
          <Calendar size={12} className="text-[#555]" />
          <span className="text-xs text-[#777]">Founded {profile.founded}</span>
        </div>
        <div className="flex items-center gap-2">
          <Users size={12} className="text-[#555]" />
          <span className="text-xs text-[#777]">
            {profile.employees.toLocaleString()} employees
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Globe size={12} className="text-[#555]" />
          <a
            href={`https://${profile.website}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-[#3B82F6] hover:text-[#60A5FA] transition-colors"
          >
            {profile.website}
          </a>
        </div>
      </div>

      <div className="flex gap-2 mb-3">
        <span className="text-[10px] px-2 py-1 rounded-md bg-[#1A1A1E] text-[#888] border border-[#2A2A30]">
          {profile.sector}
        </span>
        <span className="text-[10px] px-2 py-1 rounded-md bg-[#1A1A1E] text-[#888] border border-[#2A2A30]">
          {profile.industry}
        </span>
      </div>

      {expanded && (
        <p className="text-xs text-[#666] leading-relaxed">{profile.description}</p>
      )}
    </div>
  );
}
