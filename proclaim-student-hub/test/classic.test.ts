import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Classic, made better (1.5): the polish must stay inside Classic.

const src = path.resolve(__dirname, "../src");
const read = (f: string) => fs.readFileSync(path.join(src, f), "utf8");

/** Every selector list in a stylesheet (comments and @media lines left out). */
function selectors(css: string): string[] {
  const out: string[] = [];
  for (const block of css.replace(/\/\*[\s\S]*?\*\//g, "").split("{")) {
    const sel = block.split("}").pop()?.trim() ?? "";
    if (sel && !sel.startsWith("@")) {
      out.push(...sel.split(",").map((s) => s.trim()));
    }
  }
  return out;
}

describe("Classic polish", () => {
  it("only touches Classic, apart from hiding its own extras elsewhere", () => {
    const sels = selectors(read("classic.css"));
    expect(sels.length).toBeGreaterThan(20);
    const leaks = sels.filter(
      (s) => !s.startsWith(":root:not([data-style])") && s !== ".tile-ic" && s !== ".li-dot",
    );
    expect(leaks).toEqual([]);
  });

  it("loads after the other styles, so it wins", () => {
    const imports = [...read("main.tsx").matchAll(/^import "\.\/([\w-]+\.css)";$/gm)].map(
      (m) => m[1],
    );
    expect(imports.at(-1)).toBe("classic.css");
    expect(imports.indexOf("looks.css")).toBe(imports.length - 2);
  });

  it("homework chips wrap through a class a style can change, not an inline style", () => {
    const hw = read("screens/Homework.tsx");
    expect(hw).toContain('className="row hw-chips"');
    expect(hw).not.toMatch(/flexWrap: "wrap"/);
    expect(read("bento.css")).toMatch(/\.hw-chips \{\s*gap: 8px;\s*flex-wrap: wrap;/);
  });

  it("rows inside a list card are square, so the lines between them stay straight", () => {
    expect(read("fix-polish.css")).toMatch(
      /\.card\.rows > \.swipe,\s*\.card\.rows > \.swipe \.under \{\s*border-radius: 0;/,
    );
  });
});
