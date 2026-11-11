import { describe, expect, it } from "vitest";
import { capToRemaining, defaultBond, forfeitAtExpiry, forfeitPercent, minBondFor, remainingCapacity, validatePostRules, type PostRuleInput } from "./rules.ts";
import { blockReason, BLOCK_COPY } from "./take.ts";

const E18 = 10n ** 18n;
const u = (n: number) => BigInt(Math.round(n * 100)) * (E18 / 100n);

describe("forfeit at expiry", () => {
  // Long: entry 100, stop 95 (risk 5), bond 10.
  const long = { isLong: true, entry: u(100), stop: u(95), bond: u(10) };
  it("a long in profit forfeits nothing", () => {
    expect(forfeitAtExpiry({ ...long, mark: u(103) })).toBe(0n);
  });
  it("at entry forfeits nothing", () => {
    expect(forfeitAtExpiry({ ...long, mark: u(100) })).toBe(0n);
  });
  it("a long under entry forfeits bond * adverse / risk", () => {
    expect(forfeitAtExpiry({ ...long, mark: u(98) })).toBe(u(4)); // 2 of 5 adverse: 40%
    expect(forfeitAtExpiry({ ...long, mark: u(96.5) })).toBe(u(7)); // 3.5 of 5: 70%
  });
  it("a short is the mirror", () => {
    const short = { isLong: false, entry: u(100), stop: u(105), bond: u(10) };
    expect(forfeitAtExpiry({ ...short, mark: u(97) })).toBe(0n);
    expect(forfeitAtExpiry({ ...short, mark: u(100) })).toBe(0n);
    expect(forfeitAtExpiry({ ...short, mark: u(102) })).toBe(u(4));
    expect(forfeitAtExpiry({ ...short, mark: u(103.5) })).toBe(u(7));
  });
  it("rounds down like the contract integer division", () => {
    expect(forfeitAtExpiry({ isLong: true, entry: 100n, stop: 97n, bond: 10n, mark: 99n })).toBe(3n); // 10 * 1 / 3
  });
  it("at or past the stop it is the whole bond", () => {
    expect(forfeitAtExpiry({ ...long, mark: u(95) })).toBe(u(10));
    expect(forfeitAtExpiry({ ...long, mark: u(90) })).toBe(u(10));
  });
  it("never divides by a zero stop distance", () => {
    expect(forfeitAtExpiry({ isLong: true, entry: u(100), stop: u(100), bond: u(10), mark: u(99) })).toBe(0n);
  });
  it("words the share as a whole percent", () => {
    expect(forfeitPercent(u(6), u(10))).toBe(60);
    expect(forfeitPercent(0n, u(10))).toBe(0);
    expect(forfeitPercent(1n, 0n)).toBe(0);
  });
});

describe("bond for a capacity", () => {
  it("is the larger of the minimum and 2% of capacity", () => {
    expect(minBondFor(u(100), u(5))).toBe(u(5));
    expect(minBondFor(u(250), u(5))).toBe(u(5));
    expect(minBondFor(u(1000), u(5))).toBe(u(20));
    expect(minBondFor(null, u(5))).toBe(u(5));
    expect(minBondFor(0n, u(5))).toBe(u(5));
  });
  it("rounds 2% up so the contract check passes", () => {
    const cap = 123_456_789_012_345_678_901n; // 2% is not a whole number of wei
    const need = minBondFor(cap, 0n);
    expect(need * 10_000n >= cap * 200n).toBe(true);
    expect((need - 1n) * 10_000n < cap * 200n).toBe(true);
  });
  it("the default bond is rounded up to a cent and still valid", () => {
    expect(defaultBond(u(1234.5), u(5))).toBe(u(24.69));
    expect(defaultBond(u(100), u(5))).toBe(u(5));
    const b = defaultBond(u(1234.5), u(5));
    expect(b * 10_000n >= u(1234.5) * 200n).toBe(true);
  });
});

describe("post rules", () => {
  // Long on a mark of 100: entry 100, stop 95 (5%), target 110.
  const ok: PostRuleInput = { isLong: true, entry: u(100), stop: u(95), target: u(110), mark: u(100), capacity: u(250), bond: u(5), minBond: u(5), expirySecs: 86400 };
  const say = (o: Partial<PostRuleInput>) => validatePostRules({ ...ok, ...o });
  it("accepts a good call", () => {
    expect(say({})).toEqual([]);
  });
  it("needs a capacity", () => {
    expect(say({ capacity: null })).toEqual(["Enter a follower capacity above zero."]);
    expect(say({ capacity: 0n })).toEqual(["Enter a follower capacity above zero."]);
  });
  it("needs the minimum bond and 2% of capacity", () => {
    expect(say({ bond: u(4) })[0]).toContain("at least 5 USDso");
    expect(say({ capacity: u(1000), bond: u(19) })[0]).toContain("2% of your capacity: 20.00 USDso");
    expect(say({ capacity: u(1000), bond: u(20) })).toEqual([]);
    expect(say({ bond: null })).toEqual([]); // the composer words a missing bond itself
  });
  it("the mark must sit between stop and target", () => {
    expect(say({ mark: u(96), entry: u(96), stop: u(95), target: u(110) })).toEqual([]);
    expect(say({ mark: u(94), entry: u(96) }).join(" ")).toContain("must sit between");
    expect(say({ mark: u(111), entry: u(110.5), target: u(111) }).join(" ")).toContain("must sit between");
    expect(say({ mark: u(110) }).join(" ")).toContain("must sit between"); // on the target is not strictly inside
  });
  it("a short mirrors the order", () => {
    const sh = { isLong: false, entry: u(100), stop: u(105), target: u(90), mark: u(100) };
    expect(say(sh)).toEqual([]);
    expect(say({ ...sh, mark: u(106) }).join(" ")).toContain("must sit between your target and your stop");
  });
  it("the entry must be within 0.5% of the mark", () => {
    expect(say({ entry: u(100.5) })).toEqual([]); // exactly 0.5%
    expect(say({ entry: u(100.51) }).join(" ")).toContain("within 0.5%");
    expect(say({ entry: u(99.4) }).join(" ")).toContain("within 0.5%");
  });
  it("the stop must be between 0.1% and 10% of entry", () => {
    expect(say({ stop: u(90), target: u(120) })).toEqual([]); // exactly 10%
    expect(say({ stop: u(89.9), target: u(120) }).join(" ")).toContain("too far");
    expect(say({ stop: u(99.9), target: u(110) })).toEqual([]); // exactly 0.1%
    expect(say({ stop: u(99.95), target: u(110) }).join(" ")).toContain("too close");
  });
  it("the target must be at least as far as the stop", () => {
    expect(say({ stop: u(95), target: u(105) })).toEqual([]); // equal is fine
    expect(say({ stop: u(95), target: u(104) }).join(" ")).toContain("at least as far");
  });
  it("cannot judge the levels without a mark", () => {
    expect(say({ mark: null }).join(" ")).toContain("live price is not readable");
  });
  it("leaves the order of the three levels to the price check", () => {
    expect(say({ stop: u(101) })).toEqual([]);
    expect(say({ entry: null })).toEqual([]);
  });
  it("the expiry must be allowed", () => {
    expect(say({ expirySecs: 1 }).join(" ")).toContain("expiry");
    expect(say({ expirySecs: 30 * 86400 })).toEqual([]);
    expect(say({ expirySecs: 30 * 86400 + 1 }).join(" ")).toContain("expiry");
  });
});

describe("capacity left", () => {
  it("is capacity minus covered and never negative", () => {
    expect(remainingCapacity(u(250), u(40))).toBe(u(210));
    expect(remainingCapacity(u(250), u(250))).toBe(0n);
    expect(remainingCapacity(u(250), u(300))).toBe(0n);
  });
  it("caps a planned size to what is left", () => {
    expect(capToRemaining(u(100), u(210))).toEqual({ notional: u(100), capped: false });
    expect(capToRemaining(u(100), u(60))).toEqual({ notional: u(60), capped: true });
    expect(capToRemaining(u(100), 0n)).toEqual({ notional: 0n, capped: true });
  });
  it("blocks a full call and an unreadable ledger, but not a call with room", () => {
    const base = { status: "open" as const, isCaller: false, wrongNetwork: false, isLong: true, mark: u(100), stop: u(95), target: u(110) };
    expect(blockReason({ ...base, remaining: 0n })).toBe("full");
    expect(BLOCK_COPY.full).toBe("This call is full: its bond covers no more takers.");
    expect(blockReason({ ...base, remaining: null })).toBe("capacityUnknown");
    expect(blockReason({ ...base, remaining: u(10) })).toBeNull();
    expect(blockReason(base)).toBeNull();
  });
  it("other blocks come first", () => {
    const base = { isCaller: false, wrongNetwork: false, isLong: true, mark: u(100), stop: u(95), target: u(110), remaining: 0n };
    expect(blockReason({ ...base, status: "resolved" })).toBe("resolved");
    expect(blockReason({ ...base, status: "open", isCaller: true })).toBe("isCaller");
  });
});
