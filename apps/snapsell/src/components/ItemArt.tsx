/** Simple item illustrations used on the welcome screen and in empty states. */
export function ItemArt({ kind, size = 120 }: { kind: "headphones" | "sneaker" | "camera"; size?: number }) {
  if (kind === "sneaker")
    return (
      <svg width={size} height={size} viewBox="0 0 200 200" aria-hidden="true">
        <path d="M30 130 C30 110 40 95 55 92 L80 88 C90 100 105 104 120 104 L150 112 C165 116 172 124 172 134 L172 142 L30 142 Z" fill="#FAFAF7" stroke="#17150F" strokeWidth="5" strokeLinejoin="round" />
        <path d="M30 142 H172 V150 H30 Z" fill="#17150F" />
        <path d="M70 100 L78 116 M86 100 L94 116 M102 104 L108 118" stroke="#17150F" strokeWidth="4" strokeLinecap="round" />
        <path d="M120 118 C135 118 150 124 160 134" stroke="#FF5B24" strokeWidth="6" fill="none" strokeLinecap="round" />
      </svg>
    );
  if (kind === "camera")
    return (
      <svg width={size} height={size} viewBox="0 0 200 200" aria-hidden="true">
        <rect x="30" y="70" width="140" height="84" rx="12" fill="#17150F" />
        <rect x="30" y="92" width="140" height="40" fill="#8A8373" />
        <rect x="50" y="58" width="36" height="16" rx="4" fill="#17150F" />
        <circle cx="100" cy="112" r="30" fill="#2B2922" stroke="#D9D3C4" strokeWidth="5" />
        <circle cx="100" cy="112" r="14" fill="#4B5D6B" />
      </svg>
    );
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" aria-hidden="true">
      <path d="M40 120 V100 a60 60 0 0 1 120 0 V120" fill="none" stroke="#17150F" strokeWidth="12" strokeLinecap="round" />
      <rect x="28" y="108" width="36" height="58" rx="16" fill="#17150F" />
      <rect x="136" y="108" width="36" height="58" rx="16" fill="#17150F" />
      <rect x="36" y="118" width="20" height="38" rx="9" fill="#3A372F" />
      <rect x="144" y="118" width="20" height="38" rx="9" fill="#3A372F" />
    </svg>
  );
}
