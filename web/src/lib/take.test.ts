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
  stopSafeMargin,
  settledOr,
  withRetry,
  withTimeout,
  hedge,
  marginForTake,
  stopBeforeLiquidation,
  tagCallId,
  voucherUsable,
  CLAIM_REFUSED_COPY,
  unrealizedPnl,
  type SizeRules,
} from "./take.ts";
import { classifyReadError, NOT_CONNECTED_COPY, READ_RETRIES, UNREACHABLE_COPY } from "./readstate.ts";
import { ageLabel, isPriceUsable, markAgeSec, parseLiveState, toSeconds } from "./mark.ts";
import { parseMarketRow } from "./useMarkets.ts";

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

describe("voucher that the chain calls eligible but reverts", () => {
  it("is not offered when the simulated claim fails", () => {
    expect(voucherUsable(true, false)).toBe(false);
    expect(voucherUsable(true, true)).toBe(true);
    expect(voucherUsable(false, true)).toBe(false);
  });
  it("falls back to deposit when the wallet has USDso, else to the external route", () => {
    const shortfall = 6n * E18;
    expect(marginPlan({ walletUsdso: 50n * E18, shortfall, voucherEligible: voucherUsable(true, false) })).toBe("deposit");
    expect(marginPlan({ walletUsdso: 0n, shortfall, voucherEligible: voucherUsable(true, false) })).toBe("external");
  });
  it("shows plain copy when a claim still reverts", () => {
    expect(describeTakeError(new Error(CLAIM_REFUSED_COPY))).toEqual({ kind: "error", message: CLAIM_REFUSED_COPY });
  });
});

describe("margin that keeps the stop ahead of liquidation", () => {
  const notional = 25n * E18;
  const mark = 73600n * E18;
  it("a long with the stop 5% away needs at least 6.25% of notional", () => {
    const stop = (mark * 95n) / 100n;
    const m = stopSafeMargin(notional, mark, stop, 125n);
    expect(m).toBeGreaterThanOrEqual((notional * 625n) / 10000n);
    expect(m).toBe((notional * 825n) / 10000n); // 5% + 1.25% + 2%
  });
  it("a short is mirrored: the stop 5% above needs the same", () => {
    const stop = (mark * 105n) / 100n;
    const m = stopSafeMargin(notional, mark, stop, 125n);
    expect(m).toBeGreaterThanOrEqual((notional * 625n) / 10000n);
  });
  it("beats the max-leverage initial margin and is never lower than it", () => {
    const stop = (mark * 95n) / 100n;
    const need = marginForTake(notional, 280n, mark, stop, 125n);
    expect(need).toBeGreaterThan(requiredMargin(notional, 280n) * 2n);
    expect(marginForTake(notional, 2000n, mark, (mark * 99n) / 100n, 125n)).toBe(requiredMargin(notional, 2000n));
  });
  it("defaults the maintenance margin to 1.25%", () => {
    const stop = (mark * 95n) / 100n;
    expect(stopSafeMargin(notional, mark, stop)).toBe(stopSafeMargin(notional, mark, stop, 125n));
  });
  it("checks the stop is hit before liquidation, per side", () => {
    expect(stopBeforeLiquidation(true, 69920n * E18, 68000n * E18)).toBe(true);
    expect(stopBeforeLiquidation(true, 69920n * E18, 71000n * E18)).toBe(false);
    expect(stopBeforeLiquidation(false, 80000n * E18, 82000n * E18)).toBe(true);
    expect(stopBeforeLiquidation(false, 80000n * E18, 79000n * E18)).toBe(false);
    expect(stopBeforeLiquidation(true, 69920n * E18, null)).toBe(true);
  });
});

describe("resilient reads", () => {
  it("keeps the previous value when a read failed and takes the new one when it worked", () => {
    const ok: PromiseSettledResult<number> = { status: "fulfilled", value: 7 };
    const bad: PromiseSettledResult<number> = { status: "rejected", reason: new Error("slow") };
    expect(settledOr(ok, 1)).toBe(7);
    expect(settledOr(bad, 1)).toBe(1);
    expect(settledOr(bad, null)).toBeNull();
  });
  it("one failed read does not hide the others", async () => {
    const rs = await Promise.allSettled([Promise.resolve("readiness"), Promise.reject(new Error("getPosition timed out")), Promise.resolve("limit")]);
    expect(rs.map((r) => settledOr(r as PromiseSettledResult<string | null>, null))).toEqual(["readiness", null, "limit"]);
  });
  it("retries a flaky read and gives up after the last try", async () => {
    let n = 0;
    const flaky = async () => {
      n++;
      if (n < 3) throw new Error("took too long");
      return "ok";
    };
    expect(await withRetry(flaky, 2, 1)).toBe("ok");
    expect(n).toBe(3);
    let m = 0;
    await expect(withRetry(async () => { m++; throw new Error("down"); }, 2, 1)).rejects.toThrow("down");
    expect(m).toBe(3);
  });
  it("times out a read that never answers", async () => {
    await expect(withTimeout(new Promise(() => {}), 20)).rejects.toThrow("too long");
    expect(await withTimeout(Promise.resolve(5), 20)).toBe(5);
  });
});

describe("live mark parsing and staleness", () => {
  it("reads the on-chain state, not the indexer snapshot", () => {
    const s = parseLiveState({ markPrice: 73763771350586626500000n, markPriceOk: true, indexPrice: 73760000000000000000000n, indexUpdatedAt: 1762829000n });
    expect(s).toEqual({ markPrice: "73763771350586626500000", indexPrice: "73760000000000000000000", markOk: true, indexUpdatedAtSec: 1762829000 });
  });
  it("flags a stale feed as not ok and never as live", () => {
    expect(parseLiveState({ markPrice: 73653424212673681500000n, markPriceOk: false, indexPrice: 0n })?.markOk).toBe(false);
    expect(parseLiveState({ markPrice: 0n, markPriceOk: true })?.markOk).toBe(false);
    expect(parseLiveState({ markPrice: 5n })?.markOk).toBe(false); // a missing flag is not ok
  });
  it("rejects unusable input", () => {
    expect(parseLiveState(null)).toBeNull();
    expect(parseLiveState({ markPrice: "abc", markPriceOk: true })).toBeNull();
  });
  it("normalises timestamps from seconds, ms and ns", () => {
    expect(toSeconds(1762829000n)).toBe(1762829000);
    expect(toSeconds(1762829000123n)).toBe(1762829000);
    expect(toSeconds(1762829000123456789n)).toBe(1762829000);
    expect(toSeconds(0n)).toBe(0);
    expect(toSeconds(undefined)).toBe(0);
  });
  it("labels the age truthfully", () => {
    expect(markAgeSec(10_000, 13_400)).toBe(3);
    expect(markAgeSec(20_000, 10_000)).toBe(0);
    expect(ageLabel(0)).toBe("updated just now");
    expect(ageLabel(3)).toBe("updated 3s ago");
    expect(ageLabel(125)).toBe("updated 2m ago");
  });
  it("only lets a fresh, positive mark drive a take or an entry", () => {
    expect(isPriceUsable(true, 1n)).toBe(true);
    expect(isPriceUsable(false, 1n)).toBe(false);
    expect(isPriceUsable(true, null)).toBe(false);
    expect(isPriceUsable(true, 0n)).toBe(false);
  });
  it("blocks a take while the price feed is stale", () => {
    const base = { status: "open" as const, isCaller: false, wrongNetwork: false, isLong: true, mark: 73600n * E18, stop: 69920n * E18, target: 80960n * E18 };
    expect(blockReason({ ...base, priceOk: false })).toBe("stalePrice");
    expect(blockReason({ ...base, priceOk: true })).toBeNull();
    expect(blockReason({ ...base, status: "expired", priceOk: false })).toBe("expired");
  });
  it("parses API rows, treating a missing markOk as stale", () => {
    const row = { pool: "0x1", symbol: "BTC/USDso:USDso", name: "BTC-PERP", markPrice: "73763771350586626500000", indexPrice: "1", markOk: true, readAt: 5, tickSize: "100000000000000000", marginBank: "0x2", stopRegistry: "0x3", quoteToken: "0x4", minQuantity: "13000", lotSize: "1000", baseDecimals: 8 };
    expect(parseMarketRow(row)?.markOk).toBe(true);
    expect(parseMarketRow({ ...row, markOk: undefined })?.markOk).toBe(false);
    expect(parseMarketRow({ ...row, markPrice: "null" })).toBeNull();
  });
});

describe("read failure classification", () => {
  it("calls a missing call missing, and everything else an error", () => {
    expect(classifyReadError(new Error('The contract function "getCall" reverted with the following reason: NoSuchCall()'))).toBe("missing");
    expect(classifyReadError({ shortMessage: "reverted: NoSuchCall" })).toBe("missing");
    expect(classifyReadError(new Error("The request took too long."))).toBe("error");
    expect(classifyReadError(new Error('{"code":-32603,"message":"node not ready"}'))).toBe("error");
    expect(classifyReadError(undefined)).toBe("error");
  });
  it("never reports a network failure as not configured", () => {
    // not configured is decided by a missing address before any read; a failed read is always "error"
    expect(classifyReadError(new Error("fetch failed"))).toBe("error");
    expect(UNREACHABLE_COPY).toContain("Your calls are safe on chain");
    expect(UNREACHABLE_COPY).not.toContain("not been connected");
    expect(NOT_CONNECTED_COPY).toContain("not been connected");
  });
  it("retries a read that fails twice, then reads it", async () => {
    let n = 0;
    const v = await withRetry(async () => { n++; if (n < 3) throw new Error("node not ready"); return [1n]; }, READ_RETRIES, 1);
    expect(v).toEqual([1n]);
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

describe("hedged reads", () => {
  it("returns the first success and does not wait for a hung first copy", async () => {
    let n = 0;
    const fn = () => {
      n++;
      return n === 1 ? new Promise<string>(() => {}) : Promise.resolve("fast");
    };
    expect(await hedge(fn, [20, 40])).toBe("fast");
    expect(n).toBe(2);
  });
  it("launches the next copy straight away when one fails, and rejects only when all fail", async () => {
    let n = 0;
    await expect(hedge(async () => { n++; throw new Error("node not ready"); }, [1000, 2000])).rejects.toThrow("node not ready");
    expect(n).toBe(3);
  });
});
