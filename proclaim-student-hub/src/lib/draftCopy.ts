// A copy of the answer being typed, kept on this device on every keystroke.
// The real save (Google Doc / page storage) waits a moment after typing stops;
// if the page is closed, reloaded or remounted before that, this copy wins.

export interface LocalDraft {
  text: string;
  /** When it was typed (ms). */
  at: number;
}

const key = (id: string) => `psh.draft.${id}`;

export const draftCopy = {
  get(id: string): LocalDraft | null {
    try {
      const raw = localStorage.getItem(key(id));
      const value = raw ? (JSON.parse(raw) as Partial<LocalDraft>) : null;
      return value && typeof value.text === "string"
        ? { text: value.text, at: Number(value.at) || 0 }
        : null;
    } catch {
      return null;
    }
  },
  set(id: string, text: string) {
    try {
      localStorage.setItem(key(id), JSON.stringify({ text, at: Date.now() }));
    } catch {
      // Storage full or blocked: the normal save still runs.
    }
  },
  /** The real save has `text`; drop the copy unless something newer was typed since. */
  saved(id: string, text: string) {
    try {
      if (draftCopy.get(id)?.text === text) {
        localStorage.removeItem(key(id));
      }
    } catch {
      // Nothing to clean up.
    }
  },
};

/**
 * Which text to show when a homework opens: the device copy when it holds
 * typing the real save never got (it is only kept until a save succeeds).
 */
export function pickDraft(
  saved: string,
  local: LocalDraft | null,
): { text: string; unsaved: boolean } {
  if (!local || local.text === saved) {
    return { text: saved, unsaved: false };
  }
  return { text: local.text, unsaved: true };
}
