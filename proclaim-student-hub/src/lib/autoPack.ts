import { packFromTopic } from "../lab/scan.ts";
import { labPacks, settings } from "../lab/store.ts";
import type { AiProvider } from "./ai.ts";
import { labSubject, notes, packToNote, prepTests, type PrepTest } from "./study.ts";

// When a test is added (by hand, from "Add anything" or spotted in Classroom)
// the AI builds its revision pack straight away, so the prep plan can start
// on day one instead of at "get your material".

/** Makes the pack for a test that has none and links it. Returns the updated test, or null. */
export async function autoPack(ai: AiProvider, test: PrepTest): Promise<PrepTest | null> {
  if (test.packId) {
    return null;
  }
  const subject = labSubject(test.subject);
  const found = await packFromTopic(
    ai,
    { subject, topic: test.topic, extra: "" },
    settings.get(),
    test.start,
  );
  if (found.items.length === 0) {
    return null;
  }
  const pack = {
    ...found,
    subject,
    topic: test.topic.slice(0, 80),
    id: `p${Date.now().toString(36)}`,
    createdAt: new Date().toISOString(),
    photo: "",
    labels: [],
  };
  labPacks.saveAll([...labPacks.all(), pack]);
  // An open Lab screen re-reads its packs.
  window.dispatchEvent(new Event("psh:packs"));
  notes.upsert(packToNote(pack));
  const linked = { ...test, packId: pack.id };
  prepTests.save(prepTests.all().map((t) => (t.id === test.id ? linked : t)));
  return linked;
}

/** Fire-and-forget version for screens: toasts when the pack is ready. */
export function autoPackInBackground(
  ai: AiProvider | null,
  test: PrepTest,
  toast: (msg: string) => void,
  onLinked?: (test: PrepTest) => void,
) {
  if (!ai || test.packId) {
    return;
  }
  autoPack(ai, test).then(
    (linked) => {
      if (linked) {
        toast(`Prep pack ready for ${test.topic}: flashcards, quiz and notes.`);
        onLinked?.(linked);
      }
    },
    (err: unknown) => console.warn("Auto pack failed", err),
  );
}
