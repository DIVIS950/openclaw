import { useMemo, useSyncExternalStore } from "react";

// In-memory stand-in for next/navigation so the static build runs inside a
// sandboxed frame where the URL can't carry app state.
let current = "/";
const history: string[] = [];
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export function navigate(href: string, replace = false) {
  if (!replace) history.push(current);
  current = href.startsWith("/") ? href : `/${href}`;
  emit();
  window.scrollTo(0, 0);
}

const subscribe = (f: () => void) => {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
};

export const useHref = () => useSyncExternalStore(subscribe, () => current, () => current);
export const usePathname = () => useHref().split("?")[0];

export function useSearchParams() {
  const qs = useHref().split("?")[1] ?? "";
  return useMemo(() => new URLSearchParams(qs), [qs]);
}

export function useRouter() {
  return {
    push: (h: string) => navigate(h),
    replace: (h: string) => navigate(h, true),
    back: () => {
      const prev = history.pop();
      if (prev) {
        current = prev;
        emit();
      }
    },
    refresh: () => {},
    prefetch: () => {},
  };
}

export function notFound(): never {
  throw new Error("Not found");
}
