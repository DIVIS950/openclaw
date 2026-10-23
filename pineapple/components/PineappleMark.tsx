// The Pineapple logo as inline SVG (crisp at any size, no image request).
type Props = { size?: number; className?: string; face?: boolean };

export function PineappleMark({ size = 32, className, face = false }: Props) {
  return (
    <svg
      viewBox="0 0 64 84"
      width={(size * 64) / 84}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <g>
        <path d="M32 34C26 26 17 23 8 25c8 2 14 6 19 12z" fill="#3fb672" />
        <path d="M32 34c6-8 15-11 24-9-8 2-14 6-19 12z" fill="#3fb672" />
        <path d="M31 34C27 24 21 15 12 11c7 6 11 14 14 24z" fill="#2e9e5b" />
        <path d="M33 34c4-10 10-19 19-23-7 6-11 14-14 24z" fill="#2e9e5b" />
        <path d="M32 35c-4-11-4-23 0-33 4 10 4 22 0 33z" fill="#23864b" />
      </g>
      {/* Every instance draws identical geometry, so a shared clip-path id is safe. */}
      <clipPath id="pineapple-body">
        <ellipse cx="32" cy="58" rx="20" ry="24" />
      </clipPath>
      <ellipse cx="32" cy="58" rx="20" ry="24" fill="#ffc93c" />
      <g clipPath="url(#pineapple-body)" stroke="#e9a400" strokeWidth="2.2" strokeLinecap="round">
        {[-24, -12, 0, 12, 24, 36].map((x) => (
          <line key={`a${x}`} x1={x} y1={30} x2={x + 40} y2={86} />
        ))}
        {[28, 40, 52, 64, 76, 88].map((x) => (
          <line key={`b${x}`} x1={x} y1={30} x2={x - 40} y2={86} />
        ))}
      </g>
      <ellipse cx="25" cy="48" rx="5" ry="8" fill="#fff" opacity="0.35" />
      {face ? (
        <g fill="#3b2a1a">
          <ellipse cx="25" cy="58" rx="2.6" ry="3.2" />
          <ellipse cx="39" cy="58" rx="2.6" ry="3.2" />
          <path d="M27 66q5 5 10 0" stroke="#3b2a1a" strokeWidth="2.4" fill="none" strokeLinecap="round" />
        </g>
      ) : null}
    </svg>
  );
}
