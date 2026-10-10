import { useEffect, useState } from "react";

/** A number that counts up from 0 when it first appears (1.4 s, eased); static with reduced motion. */
export function CountUp({ n, delay = 500 }: { n: number; delay?: number }) {
  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const [shown, setShown] = useState(reduced ? n : 0);
  useEffect(() => {
    if (reduced) {
      setShown(n);
      return;
    }
    let frame = 0;
    let start = 0;
    const dur = 1400;
    const tick = (t: number) => {
      if (!start) {
        start = t;
      }
      const p = Math.min(1, (t - start) / dur);
      // Ease out: fast at first, settling on the real number.
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(n * eased));
      if (p < 1) {
        frame = requestAnimationFrame(tick);
      }
    };
    const timer = window.setTimeout(() => {
      frame = requestAnimationFrame(tick);
    }, delay);
    return () => {
      window.clearTimeout(timer);
      cancelAnimationFrame(frame);
    };
  }, [n, delay, reduced]);
  return <>{shown}</>;
}
