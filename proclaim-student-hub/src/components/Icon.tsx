import type { ReactNode } from "react";

// Stroke icons drawn for this app (not the real company logos).
const PATHS: Record<string, ReactNode> = {
  home: (
    <>
      <path d="M3 11l9-7 9 7" />
      <path d="M5 10v10h14V10" />
    </>
  ),
  homework: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </>
  ),
  sparkle: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  chevron: <path d="M9 6l6 6-6 6" />,
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 7l9 6 9-6" />
    </>
  ),
  apps: (
    <>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
    </>
  ),
  camera: (
    <>
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),
  send: (
    <>
      <path d="M12 19V5" />
      <path d="M5 12l7-7 7 7" />
    </>
  ),
  check: <path d="M5 12l5 5L20 7" />,
  sync: (
    <>
      <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" />
      <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" />
      <path d="M21 3v5h-5M3 21v-5h5" />
    </>
  ),
  loader: <path d="M21 12a9 9 0 1 1-9-9" />,
  doc: (
    <>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6" />
      <path d="M8 13h8M8 17h6" />
    </>
  ),
  game: (
    <>
      <path d="M6 8h12a4 4 0 0 1 4 4v1a4 4 0 0 1-7 2.6L14 15h-4l-1 .6A4 4 0 0 1 2 13v-1a4 4 0 0 1 4-4z" />
      <path d="M7 11v3M5.5 12.5h3" />
    </>
  ),
  star: <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />,
  flame: (
    <path d="M12 3c1 3 5 5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-4 2.5-5 .3 1.5 1 2.5 2 3 0-3-.5-5.5.5-8z" />
  ),
  image: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.5" />
      <path d="M21 16l-5-5-8 8" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </>
  ),
  speaker: (
    <>
      <path d="M4 9h4l5-4v14l-5-4H4z" />
      <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" />
    </>
  ),
  wand: (
    <>
      <path d="M4 20L15 9" />
      <path d="M15 4v3M18.5 5.5l-2 2M20 9h-3M13 3.5v0" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  link: (
    <>
      <path d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" />
      <path d="M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" />
    </>
  ),
  classroom: (
    <>
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <circle cx="12" cy="9.5" r="2" />
      <path d="M8.5 15a3.5 3.5 0 0 1 7 0" />
      <path d="M8 21h8" />
    </>
  ),
  drive: (
    <>
      <path d="M8.5 3h7l6 10.5-3.5 6.5h-12L2.5 13.5z" />
      <path d="M8.5 3l6.5 10.5h6.5" />
      <path d="M2.5 13.5h12.5L11.5 20" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 10h18" />
      <path d="M8 14h2M14 14h2M8 17h2" />
    </>
  ),
  keep: (
    <>
      <path d="M9 18h6" />
      <path d="M10 21h4" />
      <path d="M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z" />
    </>
  ),
  frost: (
    <>
      <path d="M12 2v20M3.3 7l17.4 10M3.3 17l17.4-10" />
      <path d="M9.5 3.5L12 5l2.5-1.5M9.5 20.5L12 19l2.5 1.5" />
    </>
  ),
  graph: (
    <>
      <path d="M4 3v17h17" />
      <path d="M6 17c3-9 6-10 13-12" />
    </>
  ),
  points: (
    <>
      <path d="M4 3v17h17" />
      <circle cx="9" cy="14" r="1.5" />
      <circle cx="13" cy="10" r="1.5" />
      <circle cx="18" cy="6" r="1.5" />
    </>
  ),
  todo: (
    <>
      <path d="M4 6l1.5 1.5L8 5M4 12l1.5 1.5L8 11M4 18l1.5 1.5L8 17" />
      <path d="M11 6h9M11 12h9M11 18h9" />
    </>
  ),
  flag: (
    <>
      <path d="M5 21V4" />
      <path d="M5 4h12l-2 4 2 4H5" />
    </>
  ),
  note: (
    <>
      <path d="M6 3h9l4 4v14H6z" />
      <path d="M14 3v5h5M9 13h7M9 17h5" />
    </>
  ),
  book: (
    <>
      <path d="M3 5h6a3 3 0 0 1 3 3v12a2 2 0 0 0-2-2H3z" />
      <path d="M21 5h-6a3 3 0 0 0-3 3v12a2 2 0 0 1 2-2h7z" />
    </>
  ),
  palette: (
    <>
      <path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.5-.8 1.5-1.5 0-1-.8-1.4-.8-2.3 0-.9.7-1.4 1.6-1.4H17a4 4 0 0 0 4-4C21 7 17 3 12 3z" />
      <circle cx="7.5" cy="11" r="1" />
      <circle cx="10" cy="7" r="1" />
      <circle cx="15" cy="7.5" r="1" />
    </>
  ),
};

export type IconName = keyof typeof PATHS;

export function Icon({
  name,
  size = 24,
  className,
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}
