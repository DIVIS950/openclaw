import { cn } from "@/lib/utils";

interface SkeletonProps {
  className?: string;
  animate?: boolean;
}

export function Skeleton({ className, animate = true }: SkeletonProps) {
  return (
    <div
      className={cn(
        "rounded-md bg-[#1A1A1E]",
        animate && "skeleton",
        className
      )}
    />
  );
}

export function CardSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "rounded-xl border border-[#1E1E22] bg-[#111113] p-5 space-y-3",
        className
      )}
    >
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-12" />
      </div>
      <Skeleton className="h-8 w-32" />
      <Skeleton className="h-3 w-24" />
    </div>
  );
}

export function StockCardSkeleton() {
  return (
    <div className="rounded-xl border border-[#1E1E22] bg-[#111113] p-4">
      <div className="flex items-center gap-3 mb-4">
        <Skeleton className="w-10 h-10 rounded-lg" />
        <div className="space-y-2">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
      <Skeleton className="h-7 w-28 mb-2" />
      <Skeleton className="h-3 w-20" />
    </div>
  );
}

export function NewsCardSkeleton() {
  return (
    <div className="rounded-xl border border-[#1E1E22] bg-[#111113] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-3 w-16" />
      </div>
      <Skeleton className="h-5 w-full" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-5/6" />
    </div>
  );
}

export function ChartSkeleton({ height = 300 }: { height?: number }) {
  return (
    <div
      className="rounded-xl border border-[#1E1E22] bg-[#111113] overflow-hidden"
      style={{ height }}
    >
      <div className="p-4 border-b border-[#1E1E22] flex items-center gap-2">
        {["1D", "1W", "1M", "3M", "1Y"].map((t) => (
          <Skeleton key={t} className="h-7 w-10 rounded-lg" />
        ))}
      </div>
      <div className="p-4 h-full">
        <Skeleton className="h-full w-full rounded-none" animate />
      </div>
    </div>
  );
}

export function IndexCardSkeleton() {
  return (
    <div className="rounded-xl border border-[#1E1E22] bg-[#111113] p-4">
      <div className="flex items-center justify-between mb-3">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-5 w-14 rounded-full" />
      </div>
      <Skeleton className="h-7 w-28 mb-1" />
      <Skeleton className="h-3 w-16" />
      <Skeleton className="h-8 w-full mt-3" />
    </div>
  );
}
