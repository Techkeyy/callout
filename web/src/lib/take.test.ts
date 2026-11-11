import { describe, expect, it } from "vitest";
import {
  blockReason,
  callerFee,
  cardTag,
  crossingPrice,
  describeTakeError,
  deriveStep,
  isLegalQuantity,
  marginPlan,
  notionalOf,
  notionalToQuantity,
  pnlPercent,
  requiredMargin,
  tagCallId,
  unrealizedPnl,
  type SizeRules,
} from "./take.ts";

const E18 = 10n ** 18n;
const btc: SizeRules = { baseDecimals: 8, lotSize: 1000n, minQuantity: 13000n, maxQuantity: null };
const tick = 10n ** 17n; // 0.1

describe("card tag", () => {
  it("encodes (0xCA11 << 48) | id and decodes it back", () => {
    expect(cardTag(1n)).toBe(14560419070265524225n);
    expect(cardTag(1n)).toBe((0xca11n << 48n) | 1n);
    expect(tagCallId(cardTag(42n))).toBe(42n);
    expect(tagCallId(5n)).toBeNull();
  });
});

describe("crossing price", () => {
  const mark = 73345414146174892000000n; // 73345.414...
  it("buys above the mark, aligned up to the tick", () => {
    const p = crossingPrice(mark, tick, true);
    expect(p % tick).toBe(0n);
    expect(p).toBeGreaterThanOrEqual((mark * 101n) / 100n);
    expect(p - (mark * 101n) / 100n).toBeLessThan(tick);
    expect(p).toBe(74078900000000000000000n);
  });
  it("sells below the mark, aligned down to the tick", () => {
    const p = crossingPrice(mark, tick, false);
    expect(p % tick).toBe(0n);
    expect(p).toBeLessThanOrEqual((mark * 99n) / 100n);
    expect((mark * 99n) / 100n - p).toBeLessThan(tick);
  });
  it("leaves an already-aligned price alone", () => {
    expect(crossingPrice(100n * E18, tick, true)).toBe(101n * E18);
    expect(crossingPrice(100n * E18, tick, false)).toBe(99n * E18);
  });
});

describe("sizing in raw units", () => {
  const mark = 73600n * E18;
  it("turns $25 into a lot-aligned raw quantity", () => {
    const q = notionalToQuantity(25n * E18, mark, btc);
    expect(q).toBe(33000n); // 25 / 73600 BTC = 33967 raw, aligned down to the 1000 lot
    expect(q % btc.lotSize).toBe(0n);
    expect(notionalOf(q, mark, 8)).toBeLessThanOrEqual(25n * E18);
  });
  it("never goes below the minimum quantity", () => {
    expect(notionalToQuantity(1n * E18, mark, btc)).toBe(13000n);
  });
  it("clamps to the chain's max quantity, lot aligned", () => {
    expect(notionalToQuantity(10_000n * E18, mark, { ...btc, maxQuantity: 55500n })).toBe(55000n);
  });
  it("checks legality", () => {
    expect(isLegalQuantity(34000n, btc)).toBe(true);
    expect(isLegalQuantity(12000n, btc)).toBe(false);
    expect(isLegalQuantity(34500n, btc)).toBe(false);
    expect(isLegalQuantity(60000n, { ...btc, maxQuantity: 50000n })).toBe(false);
  });
  it("prices the caller's 10 bps", () => {
    expect(callerFee(100n * E18)).toBe(E18 / 10n); // 0.1% of 100
    expect(callerFee(24937440809699463280n)).toBe(24937440809699463n);
  });
});

describe("profit and loss", () => {
  it("long gains when the mark is above entry", () => {
    expect(unrealizedPnl(100000000n, 100n * E18, 110n * E18, 8)).toBe(10n * E18); // 1 BTC
  });
  it("short gains when the mark is below entry (negative size)", () => {
    expect(unrealizedPnl(-100000000n, 100n * E18, 90n * E18, 8)).toBe(10n * E18);
    expect(unrealizedPnl(-100000000n, 100n * E18, 110n * E18, 8)).toBe(-10n * E18);
  });
  it("percent follows the position's side", () => {
    expect(pnlPercent(1n, 100n * E18, 110n * E18)).toBeCloseTo(10);
    expect(pnlPercent(-1n, 100n * E18, 110n * E18)).toBeCloseTo(-10);
    expect(pnlPercent(0n, 100n * E18, 110n * E18)).toBe(0);
  });
});

describe("blocked states", () => {
  const base = { status: "open" as const, isCaller: false, wrongNetwork: false, isLong: true, mark: 73600n * E18, stop: 69920n * E18, target: 80960n * E18 };
  it("lets an open call through", () => expect(blockReason(base)).toBeNull());
  it("blocks closed, expired and the caller", () => {
    expect(blockReason({ ...base, status: "closed" })).toBe("closed");
    expect(blockReason({ ...base, status: "expired" })).toBe("expired");
    expect(blockReason({ ...base, isCaller: true })).toBe("isCaller");
  });
  it("blocks when price is already past the stop or target, per side", () => {
    expect(blockReason({ ...base, mark: 69000n * E18 })).toBe("stopHit");
    expect(blockReason({ ...base, mark: 81000n * E18 })).toBe("targetHit");
    const short = { ...base, isLong: false, stop: 80960n * E18, target: 69920n * E18 };
    expect(blockReason({ ...short, mark: 81000n * E18 })).toBe("stopHit");
    expect(blockReason({ ...short, mark: 69000n * E18 })).toBe("targetHit");
    expect(blockReason({ ...short, mark: 73600n * E18 })).toBeNull();
  });
  it("flags the wrong network last", () => expect(blockReason({ ...base, wrongNetwork: true })).toBe("wrongNetwork"));
});

describe("current step", () => {
  const ready = { connected: true, stt: 5n * E18, margin: 40n * E18, marginNeeded: 10n * E18, approval: 10000n, hasPosition: false };
  it("walks connect, gas, margin, approve, take", () => {
    expect(deriveStep({ ...ready, connected: false })).toBe("connect");
    expect(deriveStep({ ...ready, stt: 3n * 10n ** 17n })).toBe("gas");
    expect(deriveStep({ ...ready, margin: 5n * E18 })).toBe("margin");
    expect(deriveStep({ ...ready, approval: 0n })).toBe("approve");
    expect(deriveStep(ready)).toBe("take");
  });
  it("shows 'in' once there is a position, whatever else is missing", () => {
    expect(deriveStep({ ...ready, hasPosition: true, approval: 0n, stt: 0n })).toBe("in");
  });
  it("needs exactly 0.4 STT", () => {
    expect(deriveStep({ ...ready, stt: 4n * 10n ** 17n })).toBe("take");
    expect(deriveStep({ ...ready, stt: 4n * 10n ** 17n - 1n })).toBe("gas");
  });
  it("picks how to fix short margin", () => {
    expect(marginPlan({ walletUsdso: 50n * E18, shortfall: 10n * E18, voucherEligible: true })).toBe("deposit");
    expect(marginPlan({ walletUsdso: 0n, shortfall: 10n * E18, voucherEligible: true })).toBe("voucher");
    expect(marginPlan({ walletUsdso: 0n, shortfall: 10n * E18, voucherEligible: false })).toBe("external");
  });
});

describe("fresh wallet with no margin", () => {
  it("prices margin from the desired size, not from the chain's max size", () => {
    expect(requiredMargin(25n * E18, 2000n)).toBe(5n * E18 + (5n * E18) / 20n); // 20% plus a 5% buffer
    expect(requiredMargin(0n)).toBe(0n);
  });
  it("lands on the margin step when margin is 0 and the max order size is 0", () => {
    const needed = requiredMargin(25n * E18, 1000n);
    expect(needed).toBeGreaterThan(0n);
    expect(deriveStep({ connected: true, stt: 5n * E18, margin: 0n, marginNeeded: needed, approval: 0n, hasPosition: false })).toBe("margin");
    // sizing with maxQuantity 0 must not be what decides it: the desired quantity is unclamped
    const q = notionalToQuantity(25n * E18, 73600n * E18, btc);
    expect(q).toBeGreaterThan(0n);
  });
  it("offers the voucher to a fresh voucher-eligible wallet", () => {
    expect(marginPlan({ walletUsdso: 0n, shortfall: requiredMargin(25n * E18), voucherEligible: true })).toBe("voucher");
  });
});

describe("error copy", () => {
  it("maps a no-fill IOC to plain words", () => {
    const r = describeTakeError(new Error("reverted: ImmediateOrCancelNoFill()"));
    expect(r).toEqual({ kind: "error", message: "Nobody was trading at that price, nothing changed. Try again." });
  });
  it("treats a wallet rejection as not an error, even nested", () => {
    expect(describeTakeError({ code: 4001 })).toEqual({ kind: "rejected" });
    expect(describeTakeError({ message: "x", cause: { name: "UserRejectedRequestError" } })).toEqual({ kind: "rejected" });
  });
});
