interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  rounded?: boolean;
}

export function Skeleton({
  width,
  height = 16,
  rounded = false,
}: SkeletonProps) {
  return (
    <div
      className="atlas-shimmer"
      style={{
        width: width ?? "100%",
        height,
        borderRadius: rounded
          ? "var(--atlas-radius-full)"
          : "var(--atlas-radius-sm)",
        background: `linear-gradient(
          90deg,
          var(--atlas-glass-bg) 0%,
          var(--atlas-glass-bg-light) 50%,
          var(--atlas-glass-bg) 100%
        )`,
        backgroundSize: "200% 100%",
      }}
    />
  );
}
