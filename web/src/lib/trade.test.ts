import { describe, expect, it } from "vitest";
import { closedViewOf, isClosed, loadTrade, parseTxHash, saveTrade, takePatch, totalFees, tradeKey, type KV } from "./trade";

const E18 = 10n ** 18n;
const TX = "0x" + "ab".repeat(32);
const W = "0xCc67779F8eDb2C80DC665775C5597657C512FE1A";

function mem(): KV & { m: Map<string, string> } {
  const m = new Map<string, string>();
  return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}
const broken: KV = {
  getItem() {
    throw new Error("blocked");
  },
  setItem() {
    throw new Error("full");
  },
};

describe("storage", () => {
  it("keys by call and lowercase wallet", () => {
    expect(tradeKey("4", W)).toBe(`callout:trade:4:${W.toLowerCase()}`);
  });
  it("round-trips and merges patches", () => {
    const kv = mem();
    saveTrade("4", W, { takeTx: "0x1", entryAvg: "5" }, undefined, kv);
    saveTrade("4", W, { closeTx: TX, exitAvg: "6" }, undefined, kv);
    expect(loadTrade("4", W.toLowerCase(), kv)).toEqual({ takeTx: "0x1", entryAvg: "5", closeTx: TX, exitAvg: "6" });
  });
  it("fresh replaces the old trade", () => {
    const kv = mem();
    saveTrade("4", W, { closeTx: TX }, undefined, kv);
    saveTrade("4", W, { takeTx: "0x2" }, { fresh: true }, kv);
    expect(loadTrade("4", W, kv)).toEqual({ takeTx: "0x2" });
  });
  it("never throws when storage is blocked, full or holds junk", () => {
    expect(loadTrade("4", W, broken)).toBeNull();
    expect(saveTrade("4", W, { takeTx: "x" }, undefined, broken)).toBeNull();
    const kv = mem();
    kv.setItem(tradeKey("4", W), "{not json");
    expect(loadTrade("4", W, kv)).toBeNull();
    kv.setItem(tradeKey("4", W), "[1]");
    expect(loadTrade("4", W, kv)).toBeNull();
  });
  it("works without any storage (server render)", () => {
    expect(loadTrade("4", W)).toBeNull();
    expect(saveTrade("4", W, {})).toBeNull();
  });
});

describe("takePatch", () => {
  const t = { takeTx: "0xa", openedAt: 1000, entryAvg: 2000n * E18, size: -E18, openFee: 3n, builderFee: 4n };
  it("starts a trade", () => {
    const { patch, fresh } = takePatch(null, t);
    expect(fresh).toBe(true);
    expect(patch).toMatchObject({ takeTx: "0xa", openedAt: 1000, entryAvg: (2000n * E18).toString(), size: (-E18).toString(), openFee: "3", builderFee: "4" });
  });
  it("starts a new trade after a closed one", () => {
    expect(takePatch({ takeTx: "0x0", closeTx: TX, openFee: "9" }, t).fresh).toBe(true);
  });
  it("adding to an open position keeps the first time and sums the fees", () => {
    const { patch, fresh } = takePatch({ takeTx: "0x0", openedAt: 500, openFee: "10", builderFee: "20" }, t);
    expect(fresh).toBe(false);
    expect(patch.takeTx).toBe("0x0");
    expect(patch.openedAt).toBeUndefined();
    expect(patch.openFee).toBe("13");
    expect(patch.builderFee).toBe("24");
  });
});

describe("hash helpers", () => {
  it("accepts only a 32 byte hash", () => {
    expect(parseTxHash(TX)).toBe(TX);
    expect(parseTxHash("0x12")).toBeNull();
    expect(parseTxHash(null)).toBeNull();
    expect(parseTxHash(TX + "00")).toBeNull();
    expect(isClosed({ closeTx: TX })).toBe(true);
    expect(isClosed({ closeTx: "nope" })).toBe(false);
    expect(isClosed(null)).toBe(false);
  });
});

describe("closedViewOf", () => {
  const summary = { realizedPnl: 20n * E18, fee: 1n * E18, builderFee: 0n, avgPrice: 1_980n * E18, qty: E18, newSize: 0n, blockNumber: 9n };
  it("uses the saved entry, fees and times; percent is realized over entry notional", () => {
    const v = closedViewOf({ closeTx: TX, isLong: false, summary, closedAt: 4600, stored: { entryAvg: (2000n * E18).toString(), openFee: "500", builderFee: "700", openedAt: 1000 }, baseDecimals: 18 })!;
    expect(v.entry).toBe(2000n * E18);
    expect(v.pct).toBeCloseTo(1, 4);
    expect(v.openedAt).toBe(1000);
    expect(totalFees(v)).toEqual({ total: E18 + 1200n, complete: true });
  });
  it("derives the entry on a device that never saw the take, and says the fees are partial", () => {
    const v = closedViewOf({ closeTx: TX, isLong: false, summary, closedAt: null, stored: null, baseDecimals: 18 })!;
    expect(v.entry).toBe(2000n * E18);
    expect(v.openedAt).toBeNull();
    expect(totalFees(v).complete).toBe(false);
  });
  it("is null when no fill was decoded", () => {
    expect(closedViewOf({ closeTx: TX, isLong: true, summary: { ...summary, avgPrice: null, qty: 0n }, closedAt: null, stored: null, baseDecimals: 18 })).toBeNull();
  });
});
