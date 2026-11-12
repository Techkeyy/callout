import { describe, expect, it } from "vitest";
import { callShareText, cardUrl, farcasterUrl, fmtMove, movePct, recordShareText, resultShareText, takerPayout, takerShareText, telegramUrl, whatsappUrl, xIntentUrl } from "./share";

const E18 = 10n ** 18n;
const call = { market: "BTC-PERP", isLong: true, entry: "74,349", stop: "73,040", target: "76,000", bond: "5" };

describe("call text", () => {
  it("builds the post text in lower case", () => {
    expect(callShareText(call)).toBe("i just called long btc-perp at 74,349. stop 73,040, target 76,000. 5 usdso bond says i'm right. take it on callout:");
  });
  it("handles a short and a missing bond", () => {
    expect(callShareText({ ...call, isLong: false, bond: null })).toBe("i just called short btc-perp at 74,349. stop 73,040, target 76,000. take it on callout:");
  });
});

describe("move percent by direction", () => {
  it("a long gains when the price rises", () => {
    expect(movePct(true, 100n * E18, 102n * E18)).toBeCloseTo(2, 4);
    expect(movePct(true, 100n * E18, 98n * E18)).toBeCloseTo(-2, 4);
  });
  it("a short gains when the price falls", () => {
    expect(movePct(false, 100n * E18, 98n * E18)).toBeCloseTo(2, 4);
    expect(movePct(false, 100n * E18, 102n * E18)).toBeCloseTo(-2, 4);
  });
  it("is null without a usable price", () => {
    expect(movePct(true, 0n, E18)).toBeNull();
    expect(movePct(true, E18, 0n)).toBeNull();
  });
  it("formats with a sign and enough decimals", () => {
    expect(fmtMove(2.2)).toBe("+2.2%");
    expect(fmtMove(-1.84)).toBe("-1.8%");
    expect(fmtMove(0.046)).toBe("+0.05%");
    expect(fmtMove(0)).toBe("0.00%");
    expect(fmtMove(-0.0001)).toBe("0.00%");
  });
});

describe("taker payout", () => {
  it("is the forfeit times covered over total covered", () => {
    expect(takerPayout(5n * E18, 25n * E18, 100n * E18)).toBe((5n * E18) / 4n);
    expect(takerPayout(5n * E18, 100n * E18, 100n * E18)).toBe(5n * E18);
  });
  it("rounds down and never exceeds the forfeit", () => {
    expect(takerPayout(10n, 1n, 3n)).toBe(3n);
    expect(takerPayout(5n * E18, 200n * E18, 100n * E18)).toBe(5n * E18);
  });
  it("is zero with nothing forfeited, covered, or on the ledger", () => {
    expect(takerPayout(0n, 5n, 10n)).toBe(0n);
    expect(takerPayout(5n, 0n, 10n)).toBe(0n);
    expect(takerPayout(5n, 5n, 0n)).toBe(0n);
  });
});

describe("result texts", () => {
  const base = { isLong: true, market: "BTC-PERP", move: "+2.2%", bond: "5", forfeitPct: 0, forfeit: 0n };
  it("hit", () => {
    expect(resultShareText({ ...base, outcome: "hit" })).toBe("called it. long btc-perp hit target, +2.2%. my bond came back. callout:");
  });
  it("stopped", () => {
    expect(resultShareText({ ...base, outcome: "stopped", move: "-1.8%" })).toBe("wrong on this one. my stop hit and my 5 usdso bond paid the people who took it. that's how callout works:");
    expect(resultShareText({ ...base, outcome: "stopped", bond: null })).toContain("my bond paid the people");
  });
  it("expired at a loss and in profit", () => {
    expect(resultShareText({ ...base, outcome: "expired", forfeitPct: 12, forfeit: 1n })).toContain("12% of my bond went to the people who took it");
    expect(resultShareText({ ...base, outcome: "expired", forfeitPct: 0, forfeit: 1n })).toContain("under 1% of my bond");
    expect(resultShareText({ ...base, outcome: "expired" })).toBe("my long btc-perp call expired in profit. bond back. every call is on chain. callout:");
  });
});

describe("taker and record texts", () => {
  it("taker, open and resolved", () => {
    expect(takerShareText({ caller: "0xab..cd", move: "+2.2%", open: false, payout: null })).toBe("took 0xab..cd's call on callout. call moved +2.2%.");
    expect(takerShareText({ caller: "0xab..cd", move: "+0.4%", open: true, payout: null })).toContain("call moved +0.4% so far.");
    expect(takerShareText({ caller: "0xab..cd", move: "-1.8%", open: false, payout: "0.40" })).toContain("the bond paid me 0.40 usdso.");
  });
  it("record", () => {
    expect(recordShareText({ hits: 3, stops: 1, expiredLosses: 0, rate: 75 })).toBe("my callout record: 3 hits, 1 stop, 75% hit rate. every call on chain, no edits:");
    expect(recordShareText({ hits: 1, stops: 2, expiredLosses: 1, rate: 25 })).toBe("my callout record: 1 hit, 2 stops, 1 expired at a loss, 25% hit rate. every call on chain, no edits:");
    expect(recordShareText({ hits: 0, stops: 0, expiredLosses: 0, rate: null })).toBe("my callout record: 0 hits, 0 stops. every call on chain, no edits:");
  });
});

describe("links", () => {
  it("builds the X intent link with encoded text and url", () => {
    const u = new URL(xIntentUrl("a b, c:", "https://x.test/c/1"));
    expect(u.origin + u.pathname).toBe("https://x.com/intent/post");
    expect(u.searchParams.get("text")).toBe("a b, c:");
    expect(u.searchParams.get("url")).toBe("https://x.test/c/1");
    expect(xIntentUrl("a b", "u")).not.toContain("+");
  });
  it("builds Telegram, WhatsApp and Farcaster links", () => {
    const t = new URL(telegramUrl("hi there", "https://x.test/c/1"));
    expect(t.origin + t.pathname).toBe("https://t.me/share/url");
    expect(t.searchParams.get("url")).toBe("https://x.test/c/1");
    expect(t.searchParams.get("text")).toBe("hi there");
    const w = new URL(whatsappUrl("hi", "https://x.test/c/1"));
    expect(w.origin + w.pathname).toBe("https://wa.me/");
    expect(w.searchParams.get("text")).toBe("hi https://x.test/c/1");
    const f = farcasterUrl("hi", "https://x.test/c/1");
    expect(f.startsWith("https://warpcast.com/~/compose?text=hi&embeds[]=")).toBe(true);
    expect(decodeURIComponent(f.split("embeds[]=")[1])).toBe("https://x.test/c/1");
  });
  it("builds the card url", () => {
    expect(cardUrl("https://callout.test/", 12n)).toBe("https://callout.test/c/12");
  });
});
