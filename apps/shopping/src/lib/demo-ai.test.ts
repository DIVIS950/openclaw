import { describe, expect, it } from "vitest";
import { demoAnswer } from "./demo-ai";

describe("demoAnswer", () => {
  it("recommends a safe shop and warns about the scam one", () => {
    const text = demoAnswer("cheapest airpods pro 3", "Prague");
    expect(text).toMatch(/My pick/);
    expect(text).toMatch(/Avoid MegaDealz/);
  });

  it("explains scam checks when asked in general", () => {
    expect(demoAnswer("how do I know a shop is a scam?")).toMatch(/Domain age/);
  });
});
