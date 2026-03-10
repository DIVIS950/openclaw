import fs from "node:fs/promises";
import readline from "node:readline";
import type { Command } from "commander";
import { applyReview, isDue, isNew } from "./sm2.js";
import { RevisionCardStore } from "./store.js";
import type { Card, ReviewQuality } from "./types.js";

// ─── Minimal terminal helpers (no external deps) ─────────────────────────────

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";

function bold(s: string) {
  return `${BOLD}${s}${RESET}`;
}
function dim(s: string) {
  return `${DIM}${s}${RESET}`;
}
function green(s: string) {
  return `${GREEN}${s}${RESET}`;
}
function yellow(s: string) {
  return `${YELLOW}${s}${RESET}`;
}
function cyan(s: string) {
  return `${CYAN}${s}${RESET}`;
}
function red(s: string) {
  return `${RED}${s}${RESET}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const diffDays = Math.round(diffMs / 86_400_000);
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "tomorrow";
  if (diffDays === -1) return "yesterday";
  if (diffDays > 0) return `in ${diffDays}d`;
  return `${Math.abs(diffDays)}d ago`;
}

function statusLabel(card: Card): string {
  const now = new Date();
  if (isNew(card)) return dim("new");
  if (isDue(card, now)) return red("due");
  return green(`due ${formatDate(card.dueAt)}`);
}

/** Prompt user for a line of input. */
function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer: string) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/** Pause until the user presses Enter. */
async function waitForEnter(msg = "Press Enter to reveal answer…"): Promise<void> {
  await prompt(dim(msg));
}

/** Ask user to rate their response 0–5 and return the valid quality. */
async function askQuality(): Promise<ReviewQuality> {
  const LABELS: Record<number, string> = {
    5: "Perfect",
    4: "Good (slight hesitation)",
    3: "Hard (struggled but correct)",
    2: "Wrong (answer felt easy)",
    1: "Wrong (knew it vaguely)",
    0: "Blackout",
  };
  console.log(bold("\nHow well did you know it?"));
  for (const [k, v] of Object.entries(LABELS).reverse()) {
    console.log(`  ${cyan(k)} – ${v}`);
  }
  while (true) {
    const raw = await prompt("Rating (0–5): ");
    const n = parseInt(raw, 10);
    if (!isNaN(n) && n >= 0 && n <= 5) {
      return n as ReviewQuality;
    }
    console.log(yellow("Please enter a number between 0 and 5."));
  }
}

// ─── CLI registration ─────────────────────────────────────────────────────────

export function registerRevisionCli({ program }: { program: Command }): void {
  const revision = program
    .command("revision")
    .alias("rev")
    .description("Flashcard revision system with spaced repetition (SM-2)");

  const store = new RevisionCardStore();

  // ── add ────────────────────────────────────────────────────────────────────
  revision
    .command("add")
    .description("Add a new flashcard")
    .requiredOption("-f, --front <text>", "Front of the card (question/prompt)")
    .requiredOption("-b, --back <text>", "Back of the card (answer)")
    .option("-d, --deck <name>", "Deck name", "default")
    .option("-t, --tags <tags>", "Comma-separated tags")
    .action(async (opts: { front: string; back: string; deck: string; tags?: string }) => {
      const tags = opts.tags ? opts.tags.split(",").map((t) => t.trim()).filter(Boolean) : [];
      const card = await store.addCard({ front: opts.front, back: opts.back, deck: opts.deck, tags });
      console.log(green(`✓ Card added to deck "${card.deck}" (${card.id})`));
    });

  // ── list ───────────────────────────────────────────────────────────────────
  revision
    .command("list")
    .alias("ls")
    .description("List flashcards")
    .option("-d, --deck <name>", "Filter by deck")
    .option("--due", "Show only due/new cards")
    .option("--tags <tags>", "Filter by comma-separated tags")
    .option("--json", "Output JSON")
    .action(async (opts: { deck?: string; due?: boolean; tags?: string; json?: boolean }) => {
      const tags = opts.tags ? opts.tags.split(",").map((t) => t.trim()).filter(Boolean) : [];
      let cards = await store.getCards({ deck: opts.deck, tags });
      if (opts.due) {
        const now = new Date();
        cards = cards.filter((c) => isDue(c, now));
      }

      if (opts.json) {
        console.log(JSON.stringify(cards, null, 2));
        return;
      }

      if (cards.length === 0) {
        console.log(dim("No cards found."));
        return;
      }

      for (const card of cards) {
        console.log(
          `${dim(card.id.slice(-8))}  ${bold(card.front.slice(0, 60))}  ${dim("→")}  ${card.back.slice(0, 40)}  ${statusLabel(card)}  ${dim(`[${card.deck}]`)}`,
        );
      }
      console.log(dim(`\n${cards.length} card(s)`));
    });

  // ── decks ──────────────────────────────────────────────────────────────────
  revision
    .command("decks")
    .description("List all decks")
    .option("--json", "Output JSON")
    .action(async (opts: { json?: boolean }) => {
      const decks = await store.getDecks();
      if (opts.json) {
        console.log(JSON.stringify(decks));
        return;
      }
      if (decks.length === 0) {
        console.log(dim("No decks yet."));
        return;
      }
      for (const d of decks) {
        console.log(`  ${cyan(d)}`);
      }
    });

  // ── stats ──────────────────────────────────────────────────────────────────
  revision
    .command("stats")
    .description("Show revision statistics")
    .option("-d, --deck <name>", "Show stats for a specific deck")
    .option("--json", "Output JSON")
    .action(async (opts: { deck?: string; json?: boolean }) => {
      const stats = await store.getDeckStats(opts.deck);
      if (opts.json) {
        console.log(JSON.stringify(stats, null, 2));
        return;
      }
      if (stats.length === 0) {
        console.log(dim("No cards yet."));
        return;
      }

      const COL = [20, 8, 8, 8, 8];
      const header = [
        bold("Deck".padEnd(COL[0] ?? 20)),
        bold("Total".padStart(COL[1] ?? 8)),
        bold("Due".padStart(COL[2] ?? 8)),
        bold("New".padStart(COL[3] ?? 8)),
        bold("Learned".padStart(COL[4] ?? 8)),
      ].join("  ");
      console.log(header);
      console.log(dim("─".repeat(60)));

      for (const s of stats) {
        const row = [
          s.deck.slice(0, (COL[0] ?? 20) - 1).padEnd(COL[0] ?? 20),
          String(s.total).padStart(COL[1] ?? 8),
          (s.due > 0 ? red(String(s.due)) : String(s.due)).padStart(COL[2] ?? 8),
          String(s.new).padStart(COL[3] ?? 8),
          green(String(s.learned)).padStart(COL[4] ?? 8),
        ].join("  ");
        console.log(row);
      }
    });

  // ── review ─────────────────────────────────────────────────────────────────
  revision
    .command("review")
    .description("Start an interactive review session")
    .option("-d, --deck <name>", "Review a specific deck")
    .option("-n, --limit <n>", "Max cards to review", "20")
    .action(async (opts: { deck?: string; limit: string }) => {
      const limit = Math.max(1, parseInt(opts.limit, 10) || 20);
      const cards = await store.getDueCards({ deck: opts.deck, limit });

      if (cards.length === 0) {
        console.log(green("✓ Nothing due for review right now! Great job."));
        return;
      }

      const deckLabel = opts.deck ? ` (deck: ${opts.deck})` : "";
      console.log(bold(`\nRevision session${deckLabel} — ${cards.length} card(s)\n`));

      let correct = 0;
      const reviewed: string[] = [];

      for (let i = 0; i < cards.length; i++) {
        const card = cards[i] as Card;
        console.log(dim(`─── Card ${i + 1}/${cards.length} [${card.deck}] ─────────────────────────`));
        console.log(bold("\nFRONT:\n") + card.front);
        if (card.tags.length > 0) {
          console.log(dim(`Tags: ${card.tags.join(", ")}`));
        }

        await waitForEnter();

        console.log(bold("\nBACK:\n") + card.back);

        const quality = await askQuality();
        const updates = applyReview(card, quality);
        await store.updateCard(card.id, updates);

        if (quality >= 3) {
          correct++;
          console.log(green(`✓ Next review: ${formatDate(updates.dueAt)}\n`));
        } else {
          console.log(yellow(`✗ Card reset. Next review: ${formatDate(updates.dueAt)}\n`));
        }
        reviewed.push(card.id);
      }

      console.log(dim("─".repeat(50)));
      console.log(
        bold("Session complete!") +
          `  ${green(`${correct}/${cards.length}`)} correct  (${Math.round((correct / cards.length) * 100)}%)`,
      );
    });

  // ── delete ─────────────────────────────────────────────────────────────────
  revision
    .command("delete <id>")
    .alias("rm")
    .description("Delete a card by ID (or last 8 chars of ID)")
    .action(async (id: string) => {
      // Support short IDs (last 8 chars)
      const cards = await store.getCards();
      const match = cards.find((c) => c.id === id || c.id.endsWith(id));
      if (!match) {
        console.error(red(`Card not found: ${id}`));
        process.exitCode = 1;
        return;
      }
      await store.deleteCard(match.id);
      console.log(green(`✓ Deleted card ${match.id}`));
    });

  // ── import ─────────────────────────────────────────────────────────────────
  revision
    .command("import <file>")
    .description(
      "Import cards from a JSON file (array of {front, back, deck?, tags?} objects)",
    )
    .option("-d, --deck <name>", "Override deck for all imported cards")
    .action(async (file: string, opts: { deck?: string }) => {
      let raw: string;
      try {
        raw = await fs.readFile(file, "utf8");
      } catch {
        console.error(red(`Cannot read file: ${file}`));
        process.exitCode = 1;
        return;
      }

      let items: Array<{ front: string; back: string; deck?: string; tags?: string[] }>;
      try {
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) throw new Error("Expected a JSON array");
        items = parsed.map((item: Record<string, unknown>, idx: number) => {
          if (typeof item.front !== "string" || typeof item.back !== "string") {
            throw new Error(`Item ${idx} missing front/back string fields`);
          }
          return {
            front: item.front,
            back: item.back,
            deck: opts.deck ?? (typeof item.deck === "string" ? item.deck : "default"),
            tags: Array.isArray(item.tags) ? (item.tags as string[]) : [],
          };
        });
      } catch (err) {
        console.error(red(`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`));
        process.exitCode = 1;
        return;
      }

      const count = await store.importCards(items);
      console.log(green(`✓ Imported ${count} card(s)`));
    });

  // ── export ─────────────────────────────────────────────────────────────────
  revision
    .command("export")
    .description("Export all cards as JSON")
    .option("-d, --deck <name>", "Filter by deck")
    .option("-o, --output <file>", "Output file (default: stdout)")
    .action(async (opts: { deck?: string; output?: string }) => {
      const cards = await store.getCards({ deck: opts.deck });
      const json = JSON.stringify(
        cards.map(({ front, back, deck, tags }) => ({ front, back, deck, tags })),
        null,
        2,
      );
      if (opts.output) {
        await fs.writeFile(opts.output, json, "utf8");
        console.log(green(`✓ Exported ${cards.length} card(s) to ${opts.output}`));
      } else {
        console.log(json);
      }
    });
}
