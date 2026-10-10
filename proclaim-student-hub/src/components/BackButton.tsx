import { useApp, type Screen } from "../context.ts";
import { Icon } from "./Icon.tsx";

/**
 * The round "‹" at the top of screens opened from More, so every one of
 * them has the same way back (Notifications set the pattern).
 */
export function BackButton({ to = "apps", label = "Back to More" }: { to?: Screen; label?: string }) {
  const { go } = useApp();
  return (
    <button className="round back-btn rise" aria-label={label} onClick={() => go(to)}>
      <Icon name="chevronLeft" size={20} />
    </button>
  );
}
