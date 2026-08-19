import { describe, expect, it } from "vitest";

import { parseAmount } from "./amount.js";

describe("parseAmount", () => {
  it("accepts a whole IRR amount", () => {
    expect(parseAmount("125000", "IRR")).toEqual({ currency: "IRR", minor: "125000" });
  });

  it("accepts grouping commas in IRR", () => {
    expect(parseAmount("125,000", "IRR")).toEqual({ currency: "IRR", minor: "125000" });
  });

  it("rejects a decimal IRR amount such as 125.000", () => {
    expect(() => parseAmount("125.000", "IRR")).toThrow(/whole number/);
  });

  it("rejects a two-place IRR decimal that would otherwise be truncated", () => {
    expect(() => parseAmount("125.00", "IRR")).toThrow(/whole number/);
  });

  it("accepts USD with up to two decimal places", () => {
    expect(parseAmount("12.5", "USD")).toEqual({ currency: "USD", minor: "1250" });
  });

  it("rejects USD with more than two decimal places", () => {
    expect(() => parseAmount("12.555", "USD")).toThrow(/two decimal/);
  });
});
