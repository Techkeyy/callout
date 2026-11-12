import { entryFromPnl, realizedPercent, type FillSummary } from "./fills.ts";

// A follower's trade on one call, kept in the browser so the result survives a refresh. Every storage access is wrapped:
// storage can be blocked or full, and the app must work without it. Numbers are stored as strings (bigints).
export interface StoredTrade {
  takeTx?: string;
  /** Block timestamp (chain clock, seconds) of the take. */
  openedAt?: number;
  entryAvg?: string;
  /** Signed position size after the take, base units. */
  size?: string;
  openFee?: string;
  builderFee?: string;
  closeTx?: string;
  closedAt?: number;
  exitAvg?: string;
  realizedPnl?: string;
  closeFee?: string;
  /** Quantity closed, base units (positive). */
  closeQty?: string;
}

export interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem?(k: string): void;
}

export const tradeKey = (callId: string, wallet: string) => `callout:trade:${callId}:${wallet.toLowerCase()}`;

function store(kv?: KV): KV | null {
  if (kv) return kv;
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function loadTrade(callId: string, wallet: string, kv?: KV): StoredTrade | null {
  try {
    const s = store(kv);
    if (!s) return null;
    const raw = s.getItem(tradeKey(callId, wallet));
    if (!raw) return null;
    const v = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as StoredTrade) : null;
  } catch {
    return null;
  }
}

/** Merge a patch into the stored trade. A take after a closed trade starts a new trade. Returns the merged record, or null when storage is unavailable. */
export function saveTrade(callId: string, wallet: string, patch: Partial<StoredTrade>, opts?: { fresh?: boolean }, kv?: KV): StoredTrade | null {
  try {
    const s = store(kv);
    if (!s) return null;
    const prev = opts?.fresh ? null : loadTrade(callId, wallet, kv);
    const next = { ...(prev ?? {}), ...patch };
    s.setItem(tradeKey(callId, wallet), JSON.stringify(next));
    return next;
  } catch {
    return null;
  }
}

/** The record to write when a take goes through: it starts a new trade if the last one was already closed. */
export function takePatch(prev: StoredTrade | null, t: { takeTx: string; openedAt: number | null; entryAvg: bigint; size: bigint; openFee: bigint; builderFee: bigint }): { patch: StoredTrade; fresh: boolean } {
  const fresh = !prev || !!prev.closeTx;
  // Adding to an open position keeps the first take's time and adds up the fees.
  const openFee = (fresh ? 0n : BigInt(prev?.openFee ?? "0")) + t.openFee;
  const builderFee = (fresh ? 0n : BigInt(prev?.builderFee ?? "0")) + t.builderFee;
  return {
    fresh,
    patch: {
      takeTx: fresh ? t.takeTx : prev?.takeTx ?? t.takeTx,
      ...(fresh || prev?.openedAt === undefined ? (t.openedAt !== null ? { openedAt: t.openedAt } : {}) : {}),
      entryAvg: t.entryAvg.toString(),
      size: t.size.toString(),
      openFee: openFee.toString(),
      builderFee: builderFee.toString(),
    },
  };
}

export const isClosed = (t: StoredTrade | null): t is StoredTrade & { closeTx: string } => !!t && typeof t.closeTx === "string" && /^0x[0-9a-fA-F]{64}$/.test(t.closeTx);

/** A tx hash from a URL parameter, or null when it is not one. */
export function parseTxHash(raw: string | null | undefined): `0x${string}` | null {
  return raw && /^0x[0-9a-fA-F]{64}$/.test(raw) ? (raw as `0x${string}`) : null;
}

// ---------- the closed-trade view ----------


export interface ClosedView {
  closeTx: string;
  isLong: boolean;
  /** The follower's average entry. Derived from the protocol's realized P&L when it was not saved on this device. */
  entry: bigint | null;
  exit: bigint;
  /** Quantity closed (base units, positive). */
  qty: bigint;
  /** The protocol's own realized P&L for the close fill: price P&L only, fees are charged separately. */
  realizedPnl: bigint;
  closeFee: bigint;
  /** Null when this device did not see the take. */
  openFee: bigint | null;
  builderFee: bigint | null;
  openedAt: number | null;
  closedAt: number | null;
  /** Realized / entry notional, in percent. */
  pct: number | null;
}

/** Combine a verified close summary with whatever was saved at take time. */
export function closedViewOf(a: { closeTx: string; isLong: boolean; summary: FillSummary; closedAt: number | null; stored: StoredTrade | null; baseDecimals: number }): ClosedView | null {
  const s = a.summary;
  if (s.avgPrice === null || s.qty <= 0n) return null;
  const st = a.stored;
  const entry = st?.entryAvg ? BigInt(st.entryAvg) : entryFromPnl(a.isLong, s.avgPrice, s.realizedPnl, s.qty, a.baseDecimals);
  return {
    closeTx: a.closeTx,
    isLong: a.isLong,
    entry,
    exit: s.avgPrice,
    qty: s.qty,
    realizedPnl: s.realizedPnl,
    closeFee: s.fee + s.builderFee,
    openFee: st?.openFee !== undefined ? BigInt(st.openFee) : null,
    builderFee: st?.builderFee !== undefined ? BigInt(st.builderFee) : null,
    openedAt: typeof st?.openedAt === "number" ? st.openedAt : null,
    closedAt: a.closedAt,
    pct: entry ? realizedPercent(s.realizedPnl, entry, s.qty, a.baseDecimals) : null,
  };
}

/** Everything paid in fees on the trade, and whether the open side is included (it is only known on the device that took). */
export function totalFees(v: Pick<ClosedView, "closeFee" | "openFee" | "builderFee">): { total: bigint; complete: boolean } {
  const complete = v.openFee !== null && v.builderFee !== null;
  return { total: v.closeFee + (v.openFee ?? 0n) + (v.builderFee ?? 0n), complete };
}
