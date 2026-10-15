import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// A sheet moved from createPortal(child, target) to <Overlay>child</Overlay>
// once left its old target behind as visible text. Nothing but JSX may sit
// right before </Overlay>.
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : path.endsWith(".tsx") ? [path] : [];
  });

describe("Overlay sheets", () => {
  it("have no stray text before </Overlay>", () => {
    const bad = files("src").filter((f) =>
      /\n[^\n<>{}]*[\w,][^\n<>]*\n\s*<\/Overlay>/.test(readFileSync(f, "utf8")),
    );
    expect(bad).toEqual([]);
  });
});
