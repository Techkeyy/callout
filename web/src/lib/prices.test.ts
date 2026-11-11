import { describe, expect, it } from "vitest";
import { alignToTick, displayDecimals, formatPrice, ladderDistances, parsePrice, roundToTick, validatePrices } from "./prices";

describe("prices", () => {
  it("parses and formats 18-decimal prices", () => {
    expect(parsePrice("73,521.9")).toBe(73521900000000000000000n);
    expect(formatPrice(73521971404050831500000n)).toBe("73521.9714040508315");
    expect(parsePrice("abc")).toBeNull();
    expect(parsePrice("0")).toBeNull();
  });
  it("uses the SDK raw tick as is", () => {
    const tick = BigInt("100000000000000000"); // 0.1
    expect(displayDecimals(tick)).toBe(1);
    expect(alignToTick(BigInt("73521971404050831500000"), tick)).toBe(BigInt("73521900000000000000000"));
    expect(roundToTick(BigInt("73521971404050831500000"), tick)).toBe(BigInt("73522000000000000000000"));
  });
  it("validates long and short orderings", () => {
    const p = (s: string) => parsePrice(s);
    expect(validatePrices({ isLong: true, entry: p("100"), stop: p("95"), target: p("110") }).ok).toBe(true);
    expect(validatePrices({ isLong: true, entry: p("100"), stop: p("105"), target: p("110") }).ok).toBe(false);
    expect(validatePrices({ isLong: false, entry: p("100"), stop: p("105"), target: p("90") }).ok).toBe(true);
    expect(validatePrices({ isLong: false, entry: p("100"), stop: p("95"), target: p("90") }).ok).toBe(false);
    expect(validatePrices({ isLong: true, entry: null, stop: null, target: null }).problems).toHaveLength(3);
  });
  it("computes ladder distances", () => {
    const d = ladderDistances(true, 100, 95, 110);
    expect(d.toTarget).toBeCloseTo(10);
    expect(d.toStop).toBeCloseTo(5);
    expect(ladderDistances(false, 100, 105, 90).targetReached).toBe(false);
    expect(ladderDistances(false, 89, 105, 90).targetReached).toBe(true);
  });
});
