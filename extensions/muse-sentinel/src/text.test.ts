import { describe, expect, it } from "vitest";
import {
  canonicalJson,
  cleanText,
  clip,
  detailLines,
  fold,
  hostOf,
  hostPath,
  oneLine,
  pageKey,
  readString,
  safeUrl,
  semanticHash,
} from "./text.js";

describe("text helpers", () => {
  it("canonical JSON sorts keys and drops undefined", () => {
    expect(canonicalJson({ b: 1, a: { d: undefined, c: [2, undefined] } })).toBe(
      '{"a":{"c":[2,null]},"b":1}',
    );
    expect(semanticHash({ x: 1, y: 2 })).toBe(semanticHash({ y: 2, x: 1 }));
    expect(semanticHash({ x: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });

  it("folds accents and case for word matching", () => {
    expect(fold("  Přihlásit  K ODBĚRU ")).toBe("prihlasit k odberu");
    expect(fold("Zrušit")).toBe("zrusit");
  });

  it("removes bidi overrides and control characters", () => {
    expect(cleanText("Pay\u202enow\u0007\tok\n")).toBe("Paynow\tok\n");
    expect(oneLine("a\n\n b\u200b", 10)).toBe("a b");
    expect(clip("abcdef", 4)).toBe("abc…");
    expect(detailLines(["one", undefined, false, "two"])).toBe("one\ntwo");
  });

  it("reads strings and URLs", () => {
    expect(readString("  ")).toBeUndefined();
    expect(readString(5)).toBe("5");
    expect(readString({})).toBeUndefined();
    expect(hostOf("https://shop.example.com/a?b=1")).toBe("shop.example.com");
    expect(hostOf(undefined)).toBe("the current page");
    expect(hostPath("https://shop.example.com/cart?utm=x#top")).toBe("shop.example.com/cart");
    expect(hostPath("about:blank")).toBe("about:blank");
    expect(hostPath("not a url")).toBe("not a url");
  });

  it("keeps query and fragment in the page part of approval keys", () => {
    expect(pageKey("https://mail.example.com/u/0/?ik=1#inbox?compose=new")).toBe(
      "mail.example.com/u/0/?ik=1#inbox?compose=new",
    );
    expect(pageKey("about:blank")).toBe("about:blank");
    expect(pageKey(undefined)).toBeUndefined();
    expect(safeUrl("vote?id=1", "https://news.ycombinator.com/")?.href).toBe(
      "https://news.ycombinator.com/vote?id=1",
    );
    expect(safeUrl("vote?id=1")).toBeUndefined();
  });
});
