import { useApp } from "../context.ts";
import { Icon } from "./Icon.tsx";

/** A small round sparkle in a screen header: opens the AI helper over this screen. */
export function AskButton() {
  const { openAi } = useApp();
  return (
    <button className="round violet" aria-label="Ask AI about this screen" onClick={() => openAi()}>
      <Icon name="sparkle" size={18} />
    </button>
  );
}
