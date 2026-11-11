import { describe, expect, it } from "vitest";
import { claimCopy, deriveOutcome, hitRate, outcomeFromCode, rankBoard, recordLine, resolveCopy, settlementLine } from "./outcome.ts";
import { describeError, ERROR_MESSAGES } from "./callbook.ts";
import { blockReason } from "./take.ts";

const E18 = 10n ** 18n;
const lng = { isLong: true, stop: 69920n * E18, target: 80960n * E18, nowSec: 1000, expiresAtSec: 5000, markOk: true };

describe("outcome from the live mark", () => {
  it("a long hits at or above target and stops at or below stop", () => {
    expect(deriveOutcome({ ...lng, mark: 80960n * E18 })).toBe("hit");
    expect(deriveOutcome({ ...lng, mark: 81000n * E18 })).toBe("hit");
    expect(deriveOutcome({ ...lng, mark: 69920n * E18 })).toBe("stopped");
    expect(deriveOutcome({ ...lng, mark: 70000n * E18 })).toBeNull();
  });
  it("a short is mirrored", () => {
    const sh = { ...lng, isLong: false, stop: 80960n * E18, target: 69920n * E18 };
    expect(deriveOutcome({ ...sh, mark: 69000n * E18 })).toBe("hit");
    expect(deriveOutcome({ ...sh, mark: 81000n * E18 })).toBe("stopped");
    expect(deriveOutcome({ ...sh, mark: 73000n * E18 })).toBeNull();
  });
  it("reads the price first: a stopped call resolved late is STOPPED, not expired", () => {
    expect(deriveOutcome({ ...lng, mark: 69000n * E18, nowSec: 6000 })).toBe("stopped");
    expect(deriveOutcome({ ...lng, mark: 69920n * E18, nowSec: 5000 })).toBe("stopped");
  });
  it("a target passed at or after expiry is HIT", () => {
    expect(deriveOutcome({ ...lng, mark: 81000n * E18, nowSec: 6000 })).toBe("hit");
    expect(deriveOutcome({ ...lng, mark: 80960n * E18, nowSec: 5000 })).toBe("hit");
  });
  it("between the levels it is EXPIRED only once the clock allows", () => {
    expect(deriveOutcome({ ...lng, mark: 75000n * E18, nowSec: 4999 })).toBeNull();
    expect(deriveOutcome({ ...lng, mark: 75000n * E18, nowSec: 5000 })).toBe("expired");
    expect(deriveOutcome({ ...lng, mark: 75000n * E18, nowSec: 9000 })).toBe("expired");
  });
  it("a short is ordered the same way at expiry", () => {
    const sh = { ...lng, isLong: false, stop: 80960n * E18, target: 69920n * E18, nowSec: 6000 };
    expect(deriveOutcome({ ...sh, mark: 82000n * E18 })).toBe("stopped");
    expect(deriveOutcome({ ...sh, mark: 69000n * E18 })).toBe("hit");
    expect(deriveOutcome({ ...sh, mark: 75000n * E18 })).toBe("expired");
  });
  it("an unreadable price blocks even an expiry, as on chain", () => {
    expect(deriveOutcome({ ...lng, mark: null, markOk: false, nowSec: 5000 })).toBeNull();
    expect(deriveOutcome({ ...lng, mark: 75000n * E18, markOk: false, nowSec: 9000 })).toBeNull();
  });
  it("records nothing on a stale or missing price", () => {
    expect(deriveOutcome({ ...lng, mark: 81000n * E18, markOk: false })).toBeNull();
    expect(deriveOutcome({ ...lng, mark: null })).toBeNull();
    expect(deriveOutcome({ ...lng, mark: 0n })).toBeNull();
  });
  it("maps the contract enum", () => {
    expect([0, 1, 2, 3, 9].map(outcomeFromCode)).toEqual(["open", "hit", "stopped", "expired", "open"]);
    expect(outcomeFromCode(2n)).toBe("stopped");
  });
  it("words the reason", () => {
    expect(resolveCopy("hit")).toBe("The price reached the target. Record it on chain.");
    expect(resolveCopy("expired")).toContain("expired");
  });
});

describe("hit rate and record line", () => {
  it("counts hits out of hits plus stops plus expired losses", () => {
    expect(hitRate(4, 1)).toBe(80);
    expect(hitRate(0, 0)).toBeNull();
    expect(hitRate(0, 3)).toBe(0);
    expect(hitRate(2, 0, 2)).toBe(50);
    expect(hitRate(4, 1, 5)).toBe(40);
  });
  it("an expiry in profit is neutral", () => {
    expect(hitRate(1, 0, 0)).toBe(100); // the same whether or not profitable expiries exist
    expect(hitRate(0, 0, 0)).toBeNull();
  });
  it("words the record", () => {
    expect(recordLine({ hits: 4, stops: 1, expired: 0, expiredLosses: 0 })).toBe("4 hit, 1 stopped, 80% hit rate");
    expect(recordLine({ hits: 1, stops: 0, expired: 2, expiredLosses: 0 })).toBe("1 hit, 0 stopped, 2 expired, 100% hit rate");
    expect(recordLine({ hits: 1, stops: 0, expired: 2, expiredLosses: 1 })).toBe("1 hit, 0 stopped, 2 expired (1 at a loss), 50% hit rate");
    expect(recordLine({ hits: 0, stops: 0, expired: 2, expiredLosses: 0 })).toBe("0 hit, 0 stopped, 2 expired");
    expect(recordLine({ hits: 0, stops: 0, expired: 0, expiredLosses: 0 })).toBe("No resolved calls yet");
    expect(recordLine(null)).toBe("No resolved calls yet");
  });
});

describe("claim display", () => {
  it("says nothing without something to claim or before resolution", () => {
    expect(claimCopy({ amount: 0n, isCaller: false, outcome: "stopped", usdso: "0.00" })).toBeNull();
    expect(claimCopy({ amount: 5n * E18, isCaller: true, outcome: "open", usdso: "5.00" })).toBeNull();
  });
  it("a taker claims a share, the caller gets the bond back", () => {
    expect(claimCopy({ amount: 3n * E18, isCaller: false, outcome: "stopped", usdso: "3.00" })).toBe("You can claim 3.00 USDso of the caller's bond.");
    expect(claimCopy({ amount: 10n * E18, isCaller: true, outcome: "hit", usdso: "10.00" })).toBe("Your bond comes back: 10.00 USDso.");
  });
});

describe("leaderboard ranking", () => {
  const row = (caller: string, hits: number, stops: number, expired: number, takers: number, expiredLosses = 0) => ({ caller, hits, stops, expired, expiredLosses, takers, fees: 0n });
  it("needs a resolved call, ranks by hit rate then takers", () => {
    const r = rankBoard([row("0xa", 0, 0, 0, 9), row("0xb", 4, 1, 0, 2), row("0xc", 1, 0, 0, 7), row("0xd", 1, 0, 0, 3), row("0xe", 0, 0, 2, 5)]);
    expect(r.map((x) => x.caller)).toEqual(["0xc", "0xd", "0xb", "0xe"]);
    expect(r[2].rate).toBe(80);
    expect(r[3].rate).toBeNull(); // only expired calls: ranked last
  });
  it("a losing expiry counts as a miss in the rank", () => {
    const r = rankBoard([row("0xa", 2, 0, 2, 1, 2), row("0xb", 2, 0, 2, 1, 0), row("0xc", 1, 1, 0, 1)]);
    expect(r.map((x) => x.caller)).toEqual(["0xb", "0xa", "0xc"]);
    expect(r.find((x) => x.caller === "0xa")!.rate).toBe(50);
    expect(r.find((x) => x.caller === "0xb")!.rate).toBe(100);
  });
  it("returns an empty list when nobody has resolved a call", () => {
    expect(rankBoard([row("0xa", 0, 0, 0, 1)])).toEqual([]);
    expect(rankBoard([])).toEqual([]);
  });
});

describe("settlement line", () => {
  const base = { outcome: "expired" as const, priceText: "94,120.00", bond: 10n * E18, covered: 40n * E18 };
  it("says where it expired and how much of the bond goes to takers", () => {
    expect(settlementLine({ ...base, forfeit: 6n * E18 })).toBe("Expired at 94,120.00. 60% of the bond to takers.");
    expect(settlementLine({ ...base, forfeit: 1n })).toBe("Expired at 94,120.00. Under 1% of the bond to takers.");
  });
  it("in profit the bond comes back", () => {
    expect(settlementLine({ ...base, forfeit: 0n })).toBe("Expired in profit. Bond back.");
  });
  it("nobody covered means the bond is back", () => {
    expect(settlementLine({ ...base, forfeit: 6n * E18, covered: 0n })).toContain("Nobody took the call");
    expect(settlementLine({ ...base, forfeit: 6n * E18, covered: null })).toBe("Expired at 94,120.00. 60% of the bond to takers.");
  });
  it("is only for expired calls", () => {
    expect(settlementLine({ ...base, outcome: "hit", forfeit: 0n })).toBeNull();
    expect(settlementLine({ ...base, outcome: "open", forfeit: 0n })).toBeNull();
  });
});

describe("contract error copy", () => {
  it("maps every v4 error to plain words", () => {
    for (const n of ["PoolNotRegistered", "EntryOffMarket", "StopTooTight", "StopTooWide", "RewardBelowRisk", "ZeroCapacity", "BondTooSmall", "TransferFailed", "StalePrice", "NotResolvable", "AlreadyResolved", "NotClaimable", "AlreadyClaimed", "NothingToClaim"]) {
      expect(ERROR_MESSAGES[n], n).toBeTruthy();
      expect(describeError(new Error(`reverted with ${n}()`))).toEqual({ kind: "error", message: ERROR_MESSAGES[n] });
    }
  });
  it("says plainly that the price moved back", () => {
    expect(ERROR_MESSAGES.NotResolvable).toContain("no longer past");
    expect(ERROR_MESSAGES.NotResolvable).toContain("Nothing changed");
  });
  it("treats a wallet rejection as not an error", () => {
    expect(describeError({ code: 4001 })).toEqual({ kind: "rejected" });
  });
});

describe("a resolved call blocks new takes", () => {
  it("blocks as resolved before anything else", () => {
    const base = { status: "resolved" as const, isCaller: false, wrongNetwork: false, isLong: true, mark: 73600n * E18, stop: 69920n * E18, target: 80960n * E18 };
    expect(blockReason(base)).toBe("resolved");
  });
});
