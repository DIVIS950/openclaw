import { useEffect, useState } from "react";

/**
 * Something opened inside a screen (a test plan, a note) as its own history
 * step, so phone Back closes it instead of leaving the screen. `key` names it
 * in history.state; `initial` opens without a step (handed over from elsewhere).
 */
export function useOpenStep(
  key: string,
  initial: string | null = null,
): [string | null, (id: string) => void, () => void] {
  const [open, setOpen] = useState<string | null>(initial);
  const stepped = () =>
    typeof (window.history.state as Record<string, unknown> | null)?.[key] === "string";

  const openIt = (id: string) => {
    setOpen(id);
    try {
      window.history.pushState({ ...window.history.state, [key]: id }, "");
    } catch {
      // History not available: Back leaves the screen, as before.
    }
  };
  const closeIt = () => {
    if (stepped()) {
      window.history.back();
    } else {
      setOpen(null);
    }
  };
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const id = (e.state as Record<string, unknown> | null)?.[key];
      setOpen(typeof id === "string" ? id : null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [key]);
  return [open, openIt, closeIt];
}
