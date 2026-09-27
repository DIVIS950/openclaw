import { animate } from "motion/react";
import { useEffect, useRef, useState } from "react";

/** Shows a number that counts up (or down) to its new value. */
export function CountUp({ value, format }: { value: number; format: (v: number) => string }) {
  const [shown, setShown] = useState(value);
  const from = useRef(0);
  useEffect(() => {
    const controls = animate(from.current, value, {
      duration: 0.9,
      ease: [0.2, 0.8, 0.2, 1],
      onUpdate: (v) => setShown(Math.round(v)),
    });
    from.current = value;
    return () => controls.stop();
  }, [value]);
  return <>{format(shown)}</>;
}
