import { describe, expect, it } from "vitest";
import { callCardModel, compactRecord, recordCardModel, takerCardModel, takerPayoutOf, type CallCardInput } from "./cardmodel";

const E18 = 10n ** 18n;
const long: CallCardInput = {
  id: 2n,
  market: "BTC-PERP",
  isLong: true,
  entry: 74_000n * E18,
  stop: 73_000n * E18,
  target: 76_000n * E18,
  dp: 0,
  outcome: "open",
  caller: "0x8284489d1B7E995544D945E732E0801df9680d58",
  bond: 5n * E18,
  capacity: 100n * E18,
  result: null,
  record: null,
};

describe("call card", () => {
  it("is an OPEN call card with the three levels", () => {
    const m = callCardModel(long);
    expect(m.kind).toBe("call");
    expect(m.stamp).toBe("OPEN");
    expect(m.cells.map((c) => c.v)).toEqual(["74,000", "73,000", "76,000"]);
    expect(m.imagePath).toBe("/c/2/opengraph-image");
    expect(m.text).toContain("i just called long btc-perp at 74,000");
  });
  it("becomes a green HIT result with the signed move", () => {
    const m = callCardModel({ ...long, outcome: "hit", result: { price: 75_628n * E18, forfeit: 0n } });
    expect(m.kind).toBe("result");
    expect(m.stamp).toBe("HIT");
    expect(m.tone).toBe("long");
    expect(m.headline).toBe("Called it.");
    expect(m.big?.v).toBe("+2.2%");
    expect(m.big?.note).toBe("Bond returned.");
  });
  it("a short that hits shows a positive move", () => {
    const m = callCardModel({ ...long, isLong: false, stop: 75_000n * E18, target: 72_000n * E18, outcome: "hit", result: { price: 72_000n * E18, forfeit: 0n } });
    expect(m.big?.v).toBe("+2.7%");
  });
  it("STOPPED is red, says the bond went to takers, and the move is negative", () => {
    const m = callCardModel({ ...long, outcome: "stopped", result: { price: 73_000n * E18, forfeit: 5n * E18 } });
    expect(m.stamp).toBe("STOPPED");
    expect(m.tone).toBe("short");
    expect(m.headline).toBe("Paid my takers.");
    expect(m.big?.v).toBe("-1.4%");
    expect(m.big?.note).toBe("5 USDso bond to takers");
  });
  it("EXPIRED in profit returns the bond, at a loss shares part of it", () => {
    const win = callCardModel({ ...long, outcome: "expired", result: { price: 74_500n * E18, forfeit: 0n } });
    expect(win.big?.note).toBe("Expired in profit. Bond back.");
    expect(win.tone).toBe("ink");
    const loss = callCardModel({ ...long, outcome: "expired", result: { price: 73_500n * E18, forfeit: E18 } });
    expect(loss.headline).toBe("Settled at the price.");
    expect(loss.big?.note).toBe("20% of the bond to takers.");
    expect(loss.big?.v).toBe("-0.68%");
  });
});

describe("taker card", () => {
  const taker = { ...long, taker: "0x5Eb1893EE7522309FC2f9b73588c245B03d345FF", covered: 25n * E18, totalCovered: 100n * E18, claimable: null, mark: null as bigint | null };
  it("open: labels the move as so far, from the mark", () => {
    const m = takerCardModel({ ...taker, mark: 74_740n * E18 });
    expect(m.stamp).toBe("TAKEN");
    expect(m.big?.k).toBe("Call move so far");
    expect(m.big?.v).toBe("+1.0%");
    expect(m.text).toContain("so far");
    expect(m.path).toBe("/c/2/taker/0x5Eb1893EE7522309FC2f9b73588c245B03d345FF");
  });
  it("open with a live position: leads with the taker's own P&L, the call's move second (UAT: card and app disagreed)", () => {
    // The call is up 1%, but this taker entered worse and is down 0.17%: the card must say what the app says.
    const m = takerCardModel({ ...taker, mark: 74_740n * E18, position: { avgEntry: 74_867n * E18, pnl: -(16n * E18) / 100n, pct: -0.17 } });
    expect(m.big?.k).toBe("My P&L, live");
    expect(m.big?.v).toBe("-0.17%");
    expect(m.big?.tone).toBe("short");
    expect(m.big?.note).toBe("Call move +1.0% so far.");
    expect(m.cells.map((c) => c.k)).toEqual(["My entry", "Mark", "My P&L"]);
    expect(m.cells[2].v).toBe("-$0.16");
    expect(m.text).toContain("-0.17%");
  });
  it("open without a mark has no move, never a made up one", () => {
    expect(takerCardModel(taker).big).toBeNull();
  });
  it("stopped: the payout is the forfeit share of the covered size", () => {
    const stopped = { ...taker, outcome: "stopped" as const, result: { price: 73_000n * E18, forfeit: 4n * E18 } };
    expect(takerPayoutOf(stopped)).toBe(E18);
    const m = takerCardModel(stopped);
    expect(m.footR).toEqual({ k: "Bond payout", v: "1 USDso" });
    expect(m.big?.k).toBe("Call move");
    expect(m.text).toContain("the bond paid me 1 usdso");
  });
  it("prefers the claimable amount when there is one", () => {
    expect(takerPayoutOf({ outcome: "stopped", result: { price: 1n, forfeit: 4n * E18 }, covered: 25n * E18, totalCovered: 100n * E18, claimable: 2n * E18 })).toBe(2n * E18);
  });
  it("hit: no payout", () => {
    const hit = { ...taker, outcome: "hit" as const, result: { price: 76_000n * E18, forfeit: 0n } };
    expect(takerPayoutOf(hit)).toBeNull();
    expect(takerCardModel(hit).footR.k).toBe("Caller");
  });
});

describe("record card", () => {
  it("shows hit rate and counts", () => {
    const m = recordCardModel({ address: "0x8284489d1B7E995544D945E732E0801df9680d58", record: { hits: 3, stops: 1, expired: 0, expiredLosses: 0 }, posted: 4, fees: (3n * E18) / 100n, rank: { n: 2, of: 9 } });
    expect(m.big?.v).toBe("75%");
    expect(m.cells.map((c) => c.v)).toEqual(["3", "1", "0", "4", "0.03 USDso"]);
    expect(m.footR.v).toBe("#2 of 9");
    expect(m.text).toBe("my callout record: 3 hits, 1 stop, 75% hit rate. every call on chain, no edits:");
  });
  it("never shows unknown fees or rank as zero", () => {
    const m = recordCardModel({ address: "0x8284489d1B7E995544D945E732E0801df9680d58", record: { hits: 0, stops: 0, expired: 0, expiredLosses: 0 }, posted: 0, fees: null, rank: null });
    expect(m.big?.v).toBe("-");
    expect(m.cells[4].v).toBe("-");
    expect(m.footR.v).toBe("Not ranked");
  });
  it("compact record line", () => {
    expect(compactRecord({ hits: 1, stops: 1, expired: 0, expiredLosses: 0 })).toBe("1 hit, 1 stop, 50% hit rate");
    expect(compactRecord({ hits: 0, stops: 0, expired: 0, expiredLosses: 0 })).toBeNull();
  });
});
