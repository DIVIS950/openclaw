import type { Transfer } from "./transfer.ts";
import type { TutorReply } from "./tutorLink.ts";

// A link that wants to change the student's data (#import= or #tutor=) waits
// here until the student says yes in LinkConfirm. A damaged or untrusted link
// leaves a message instead, so it never fails silently.

export type PendingLink =
  | { kind: "import"; transfer: Transfer; lines: string[] }
  | { kind: "tutor"; reply: TutorReply; title: string; lines: string[] }
  | { kind: "error"; title: string; text: string };

let current: PendingLink | null = null;
const listeners = new Set<() => void>();

export const linkInbox = {
  get: (): PendingLink | null => current,
  set(next: PendingLink | null) {
    current = next;
    for (const fn of listeners) {
      fn();
    }
  },
  clear() {
    linkInbox.set(null);
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};

/** The message for a link that couldn't be read. */
export const damagedLink = (who: string): PendingLink => ({
  kind: "error",
  title: "This link couldn't be read",
  text: `It may have been cut short when it was copied. Ask ${who} to send it again.`,
});
