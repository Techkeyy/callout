// Exact, chain-sourced trade numbers from a transaction receipt. Pure (no network): the caller fetches the receipt.
// Imports use explicit .ts extensions so plain node can run it.
import { decodeEventLog } from "viem";
import { marginBankEventsAbi, orderBookEventsAbi } from "@somnia-chain/markets-sdk";

type Addr = `0x${string}`;

export interface FillSummary {
  /** Protocol realized P&L for the fills in this tx, 18-decimal USDso, signed. */
  realizedPnl: bigint;
  /** Trading fee charged to the account (18-decimal). */
  fee: bigint;
  /** The caller's fee on a take (18-decimal). Zero on a close. */
  builderFee: bigint;
  /** Quantity-weighted fill price, or null when no fill was found. */
  avgPrice: bigint | null;
  /** Total quantity filled (base units). */
  qty: bigint;
  /** The account's position size after the tx, or null when no PositionUpdated for this account and pool was found. */
  newSize: bigint | null;
  blockNumber: bigint;
}

export interface ReceiptLike {
  logs: readonly { address: string; topics: readonly `0x${string}`[]; data: `0x${string}` }[];
  blockNumber: bigint;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function decode(abi: readonly unknown[], log: { topics: readonly `0x${string}`[]; data: `0x${string}` }) {
  try {
    return decodeEventLog({ abi: abi as never, topics: log.topics as never, data: log.data, strict: false }) as unknown as { eventName: string; args: Record<string, unknown> };
  } catch {
    return null;
  }
}

/** Decode this account's fills on this pool out of one receipt. Logs from other emitters, accounts or pools are ignored. */
export function summarizeFill(receipt: ReceiptLike, account: Addr, pool: Addr, marginBank: Addr): FillSummary {
  let realizedPnl = 0n;
  let fee = 0n;
  let builderFee = 0n;
  let newSize: bigint | null = null;
  // Fills grouped by the taker order, so a tx that touched another order is not mixed into this account's price.
  const byOrder = new Map<string, { qty: bigint; notional: bigint }>();
  for (const log of receipt.logs) {
    if (!log.topics || log.topics.length === 0) continue;
    if (same(log.address, marginBank)) {
      const ev = decode(marginBankEventsAbi, log as never);
      if (!ev) continue;
      const a = ev.args;
      if (ev.eventName === "PositionUpdated" && same(String(a.account), account) && same(String(a.perpPool), pool)) {
        realizedPnl += a.realizedPnl as bigint;
        newSize = a.newSize as bigint;
      } else if (ev.eventName === "FeeCharged" && same(String(a.account), account) && same(String(a.perpPool), pool)) {
        fee += a.amount as bigint;
      } else if (ev.eventName === "BuilderFeeCharged" && same(String(a.payer), account) && same(String(a.perpPool), pool)) {
        builderFee += a.amount as bigint;
      }
    } else if (same(log.address, pool)) {
      const ev = decode(orderBookEventsAbi, log as never);
      if (!ev || ev.eventName !== "OrderFilled") continue;
      const q = ev.args.quantityFilled as bigint;
      const p = ev.args.fillPrice as bigint;
      const k = String(ev.args.takerOrderId);
      const cur = byOrder.get(k) ?? { qty: 0n, notional: 0n };
      byOrder.set(k, { qty: cur.qty + q, notional: cur.notional + q * p });
    }
  }
  let best: { qty: bigint; notional: bigint } | null = null;
  for (const g of byOrder.values()) if (!best || g.qty > best.qty) best = g;
  return {
    realizedPnl,
    fee,
    builderFee,
    avgPrice: best && best.qty > 0n ? best.notional / best.qty : null,
    qty: best?.qty ?? 0n,
    newSize,
    blockNumber: receipt.blockNumber,
  };
}

/** True only when the receipt is this wallet's own successful tx that took this account on this pool to a flat position. */
export function isVerifiedClose(
  receipt: ReceiptLike & { status?: string; from?: string },
  wallet: Addr,
  pool: Addr,
  marginBank: Addr,
): FillSummary | null {
  if (receipt.status !== undefined && receipt.status !== "success") return null;
  if (!receipt.from || !same(receipt.from, wallet)) return null;
  const s = summarizeFill(receipt, wallet, pool, marginBank);
  return s.newSize === 0n && s.qty > 0n ? s : null;
}

// ---------- math ----------

const E18 = 10n ** 18n;

/** Notional in 18-decimal quote units for a base quantity at a price. */
export function notionalOfQty(qty: bigint, price: bigint, baseDecimals: number): bigint {
  return (qty * price) / 10n ** BigInt(baseDecimals);
}

/**
 * Realized P&L as a percent of the entry notional (entry average x closed quantity). Null when it cannot be computed.
 * The sign is the protocol's own, so it already reflects direction.
 */
export function realizedPercent(realizedPnl: bigint, entryAvg: bigint, qty: bigint, baseDecimals: number): number | null {
  const q = qty < 0n ? -qty : qty;
  const n = notionalOfQty(q, entryAvg, baseDecimals);
  if (n <= 0n) return null;
  return Number((realizedPnl * 1_000_000n) / n) / 10_000;
}

/**
 * When the entry average was not saved (another device), recover it from the protocol's realized P&L:
 * long: pnl = (exit - entry) x qty, short: pnl = (entry - exit) x qty. Fees are charged separately, so this is exact
 * only when the protocol's realizedPnl is gross of fees. Null when it cannot be derived.
 */
export function entryFromPnl(isLong: boolean, exitAvg: bigint, realizedPnl: bigint, qty: bigint, baseDecimals: number): bigint | null {
  if (qty <= 0n) return null;
  const delta = (realizedPnl * 10n ** BigInt(baseDecimals)) / qty; // per-unit price move in the position's favour
  const entry = isLong ? exitAvg - delta : exitAvg + delta;
  return entry > 0n ? entry : null;
}

/** "3h 12m", "45m", "2d 4h", "30s". Null when the span is unknown or negative. */
export function formatHeld(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) return null;
  const s = Math.floor(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export { E18 };
