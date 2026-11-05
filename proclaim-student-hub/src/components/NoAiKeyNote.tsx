import { useEffect, useState } from "react";
import { useApp } from "../context.ts";
import { keyHandoff } from "../pages/keyHandoff.ts";
import { aiKey, PAGES } from "../pages/runtime.ts";

/**
 * On the website before a Claude key is added: says so before the student
 * types a question, instead of only after they send it.
 */
export function NoAiKeyNote({ onGo }: { onGo?: () => void }) {
  const { go } = useApp();
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    if (PAGES) {
      void aiKey.get().then((k) => setMissing(!k));
    }
  }, []);
  if (!missing) {
    return null;
  }
  return (
    <p className="s13 no-key-note" role="note">
      The AI isn't set up on this phone yet. A parent adds the Claude key once in{" "}
      <button
        type="button"
        className="link-btn"
        onClick={() => {
          keyHandoff.set();
          onGo?.();
          go("apps");
        }}
      >
        More › Claude AI key
      </button>
      .
    </p>
  );
}
