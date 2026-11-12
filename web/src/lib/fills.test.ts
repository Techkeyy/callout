import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, type Hex } from "viem";
import { marginBankEventsAbi, orderBookEventsAbi } from "@somnia-chain/markets-sdk";
import { entryFromPnl, formatHeld, isVerifiedClose, notionalOfQty, realizedPercent, summarizeFill } from "./fills";

const E18 = 10n ** 18n;
const BANK = "0x478769e1177c0773c43a593dccc4ad15f15f1394" as const;
const POOL = "0xD6Cb1DD58580B84D76068aC21594219ce03aeddf" as const;
const OTHER_POOL = "0x1111111111111111111111111111111111111111" as const;
const ME = "0x5Eb1893EE7522309FC2f9b73588c245B03d345FF" as const;
const OTHER = "0x47537E3A3ea6e9391F3B26Ea45618db6828c8bfF" as const;
const CALLER = "0x8284489d1B7E995544D945E732E0801df9680d58" as const;

type Ev = { abi: typeof marginBankEventsAbi | typeof orderBookEventsAbi; name: string; indexed: Record<string, unknown>; data: { type: string; v: unknown }[] };

function log(address: string, e: Ev) {
  const topics = encodeEventTopics({ abi: e.abi, eventName: e.name, args: e.indexed } as never) as Hex[];
  const data = encodeAbiParameters(e.data.map((d) => ({ type: d.type })), e.data.map((d) => d.v) as never);
  return { address, topics, data };
}

const positionUpdated = (account: string, pool: string, newSize: bigint, pnl: bigint, addr: string = BANK) =>
  log(addr, { abi: marginBankEventsAbi, name: "PositionUpdated", indexed: { account, perpPool: pool }, data: [{ type: "int128", v: newSize }, { type: "uint128", v: 2000n * E18 }, { type: "int256", v: pnl }, { type: "int256", v: 0n }] });
const feeCharged = (account: string, pool: string, amount: bigint) =>
  log(BANK, { abi: marginBankEventsAbi, name: "FeeCharged", indexed: { account, perpPool: pool }, data: [{ type: "uint256", v: amount }, { type: "uint256", v: 0n }] });
const builderFee = (payer: string, pool: string, amount: bigint) =>
  log(BANK, { abi: marginBankEventsAbi, name: "BuilderFeeCharged", indexed: { payer, builder: CALLER, perpPool: pool }, data: [{ type: "uint256", v: amount }] });
const filled = (taker: bigint, qty: bigint, price: bigint, addr: string = POOL) =>
  log(addr, { abi: orderBookEventsAbi, name: "OrderFilled", indexed: { takerOrderId: taker, makerOrderId: 99n }, data: [{ type: "uint256", v: qty }, { type: "uint256", v: 0n }, { type: "uint256", v: 0n }, { type: "uint256", v: price }] });

describe("summarizeFill", () => {
  it("decodes this account's P&L, fees, price and size, and ignores everyone else", () => {
    const receipt = {
      blockNumber: 77n,
      logs: [
        positionUpdated(ME, POOL, 0n, -20_736_000_000_000_000n),
        positionUpdated(OTHER, POOL, 9n * E18, 5n * E18), // the maker on the other side
        positionUpdated(ME, OTHER_POOL, 5n, 7n * E18), // another market
        feeCharged(ME, POOL, 4n * 10n ** 15n),
        feeCharged(OTHER, POOL, 9n * E18),
        builderFee(ME, POOL, 2n * 10n ** 15n),
        builderFee(OTHER, POOL, 9n * E18),
        filled(1n, 6_000_000_000_000_000n, 2_000n * E18),
        filled(1n, 4_000_000_000_000_000n, 2_010n * E18),
        filled(7n, 1n, 1n), // a different taker order must not bend the price
      ],
    };
    const s = summarizeFill(receipt, ME, POOL, BANK);
    expect(s.realizedPnl).toBe(-20_736_000_000_000_000n);
    expect(s.fee).toBe(4n * 10n ** 15n);
    expect(s.builderFee).toBe(2n * 10n ** 15n);
    expect(s.newSize).toBe(0n);
    expect(s.qty).toBe(10_000_000_000_000_000n);
    // (0.006 x 2000 + 0.004 x 2010) / 0.01 = 2004
    expect(s.avgPrice).toBe(2_004n * E18);
    expect(s.blockNumber).toBe(77n);
  });
  it("only trusts events emitted by the margin bank and the pool", () => {
    const fake = positionUpdated(ME, POOL, 0n, 1_000n * E18, "0x2222222222222222222222222222222222222222");
    const s = summarizeFill({ blockNumber: 1n, logs: [fake, filled(1n, 1n, 5n * E18, "0x3333333333333333333333333333333333333333")] }, ME, POOL, BANK);
    expect(s.realizedPnl).toBe(0n);
    expect(s.newSize).toBeNull();
    expect(s.avgPrice).toBeNull();
  });
  it("sums several fills of one tx and keeps the last size", () => {
    const s = summarizeFill({ blockNumber: 1n, logs: [positionUpdated(ME, POOL, 3n, 2n * E18), positionUpdated(ME, POOL, 0n, 3n * E18)] }, ME, POOL, BANK);
    expect(s.realizedPnl).toBe(5n * E18);
    expect(s.newSize).toBe(0n);
  });
  it("skips logs it cannot decode", () => {
    const s = summarizeFill({ blockNumber: 1n, logs: [{ address: BANK, topics: ["0xdeadbeef" as Hex], data: "0x" }, { address: BANK, topics: [], data: "0x" }] }, ME, POOL, BANK);
    expect(s.newSize).toBeNull();
  });
});

describe("isVerifiedClose", () => {
  const logs = [positionUpdated(ME, POOL, 0n, E18), filled(1n, E18, 2_000n * E18)];
  const rc = { blockNumber: 5n, logs, status: "success", from: ME.toLowerCase() };
  it("accepts the wallet's own tx that took the position to flat", () => {
    expect(isVerifiedClose(rc, ME, POOL, BANK)?.realizedPnl).toBe(E18);
  });
  it("rejects another sender, another account, another pool, a partial close and a failed tx", () => {
    expect(isVerifiedClose({ ...rc, from: OTHER }, ME, POOL, BANK)).toBeNull();
    expect(isVerifiedClose(rc, OTHER, POOL, BANK)).toBeNull();
    expect(isVerifiedClose(rc, ME, OTHER_POOL, BANK)).toBeNull();
    expect(isVerifiedClose({ ...rc, logs: [positionUpdated(ME, POOL, 4n, E18), filled(1n, E18, 2_000n * E18)] }, ME, POOL, BANK)).toBeNull();
    expect(isVerifiedClose({ ...rc, status: "reverted" }, ME, POOL, BANK)).toBeNull();
    expect(isVerifiedClose({ ...rc, from: undefined }, ME, POOL, BANK)).toBeNull();
  });
});

describe("percent and entry math", () => {
  // The real close on chain: long 0.0096 ETH, entry 2078.68, exit 2076.52, realized -0.020736.
  const qty = 9_600_000_000_000_000n;
  it("notional is quantity times price", () => {
    expect(notionalOfQty(qty, 2_078_680_000_000_000_000_000n, 18)).toBe(19_955_328_000_000_000_000n);
  });
  it("percent of the entry notional: a losing long is negative", () => {
    const pct = realizedPercent(-20_736_000_000_000_000n, 2_078_680_000_000_000_000_000n, qty, 18)!;
    expect(pct).toBeCloseTo(-0.1039, 3);
  });
  it("a winning short is positive, from the protocol's own sign", () => {
    // short 1 ETH at 2000 closed at 1980: +20 on 2000 notional = +1%
    expect(realizedPercent(20n * E18, 2_000n * E18, E18, 18)).toBeCloseTo(1, 4);
  });
  it("accepts a signed size and refuses an empty notional", () => {
    expect(realizedPercent(E18, 2_000n * E18, -E18, 18)).toBeCloseTo(0.05, 4);
    expect(realizedPercent(E18, 0n, E18, 18)).toBeNull();
    expect(realizedPercent(E18, 2_000n * E18, 0n, 18)).toBeNull();
  });
  it("recovers the entry from the realized P&L, by direction", () => {
    expect(entryFromPnl(true, 2_076_520_000_000_000_000_000n, -20_736_000_000_000_000n, qty, 18)).toBe(2_078_680_000_000_000_000_000n);
    // short entered 2000, exited 1980, 1 ETH: +20
    expect(entryFromPnl(false, 1_980n * E18, 20n * E18, E18, 18)).toBe(2_000n * E18);
    expect(entryFromPnl(true, 1_980n * E18, 0n, 0n, 18)).toBeNull();
  });
});

describe("formatHeld", () => {
  it("reads like a person would", () => {
    expect(formatHeld(30)).toBe("30s");
    expect(formatHeld(45 * 60)).toBe("45m");
    expect(formatHeld(3 * 3600 + 12 * 60 + 5)).toBe("3h 12m");
    expect(formatHeld(2 * 86400 + 4 * 3600)).toBe("2d 4h");
    expect(formatHeld(null)).toBeNull();
    expect(formatHeld(-5)).toBeNull();
  });
});
