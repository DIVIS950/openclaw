import { describe, expect, it } from "vitest";
import { cardBrand, expiryValid, formatCardNumber, formatExpiry, luhnValid } from "./card";

describe("card helpers", () => {
  it("validates card numbers with the Luhn check", () => {
    expect(luhnValid("4242 4242 4242 4242")).toBe(true);
    expect(luhnValid("4242 4242 4242 4241")).toBe(false);
    expect(luhnValid("1234")).toBe(false);
  });

  it("detects the card brand", () => {
    expect(cardBrand("4242")).toBe("Visa");
    expect(cardBrand("5555 5555")).toBe("Mastercard");
    expect(cardBrand("3782")).toBe("Amex");
  });

  it("rejects expired or malformed dates", () => {
    const now = new Date(2026, 8, 27);
    expect(expiryValid("12/30", now)).toBe(true);
    expect(expiryValid("08/26", now)).toBe(false);
    expect(expiryValid("13/30", now)).toBe(false);
    expect(expiryValid("1230", now)).toBe(false);
  });

  it("formats input as the user types", () => {
    expect(formatCardNumber("4242424242424242")).toBe("4242 4242 4242 4242");
    expect(formatExpiry("1230")).toBe("12/30");
  });
});
