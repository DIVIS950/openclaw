import { useEffect, useRef } from "react";

// Open sheets, newest last: Escape closes only the top one.
const stack: { current: () => void }[] = [];

function onKey(e: KeyboardEvent) {
  const top = stack[stack.length - 1];
  if (e.key === "Escape" && top && !e.defaultPrevented) {
    e.preventDefault();
    top.current();
  }
}

/** Calls `onEscape` when Escape is pressed while `active` (e.g. to close a sheet). */
export function useEscape(onEscape: () => void, active = true) {
  const latest = useRef(onEscape);
  latest.current = onEscape;
  useEffect(() => {
    if (!active) {
      return;
    }
    const entry = latest;
    stack.push(entry);
    if (stack.length === 1) {
      window.addEventListener("keydown", onKey);
    }
    return () => {
      stack.splice(stack.indexOf(entry), 1);
      if (stack.length === 0) {
        window.removeEventListener("keydown", onKey);
      }
    };
  }, [active]);
}
