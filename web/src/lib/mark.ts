// Pure helpers for the live mark price. No imports.

export interface LiveState {
  /** 18-decimal raw mark price as a string. */
  markPrice: string;
  indexPrice: string;
  /** True only when the chain says the mark is fresh and usable. */
  markOk: boolean;
  /** Seconds since epoch of the last index update, or 0 when unknown. */
  indexUpdatedAtSec: number;
}

/** Normalises the chain's getPerpState result. Anything unusable becomes markOk=false, never a stale number shown as live. */
export function parseLiveState(raw: { markPrice?: unknown; markPriceOk?: unknown; indexPrice?: unknown; indexUpdatedAt?: unknown } | null | undefined): LiveState | null {
  if (!raw) return null;
  let mark: bigint;
  let index: bigint;
  try {
    mark = BigInt(raw.markPrice as bigint | string);
    index = raw.indexPrice === undefined || raw.indexPrice === null ? 0n : BigInt(raw.indexPrice as bigint | string);
  } catch {
    return null;
  }
  return {
    markPrice: mark.toString(),
    indexPrice: index.toString(),
    markOk: raw.markPriceOk === true && mark > 0n,
    indexUpdatedAtSec: toSeconds(raw.indexUpdatedAt),
  };
}

/** Timestamps may arrive in seconds, milliseconds or nanoseconds. Returns seconds, or 0 when unknown. */
export function toSeconds(v: unknown): number {
  if (v === undefined || v === null) return 0;
  let n: number;
  try {
    n = Number(BigInt(v as bigint | string | number));
  } catch {
    return 0;
  }
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n > 1e17) return Math.floor(n / 1e9); // nanoseconds
  if (n > 1e14) return Math.floor(n / 1e6); // microseconds
  if (n > 1e11) return Math.floor(n / 1e3); // milliseconds
  return Math.floor(n);
}

/** Whole seconds between when we read the chain and now. Never negative. */
export function markAgeSec(readAtMs: number, nowMs: number): number {
  return Math.max(0, Math.floor((nowMs - readAtMs) / 1000));
}

/** "updated 3s ago", "updated 2m ago". */
export function ageLabel(sec: number): string {
  if (sec < 2) return "updated just now";
  if (sec < 60) return `updated ${sec}s ago`;
  if (sec < 3600) return `updated ${Math.floor(sec / 60)}m ago`;
  return `updated ${Math.floor(sec / 3600)}h ago`;
}

export const STALE_PRICE_COPY = "Price feed is stale right now";

/** A mark may drive a take or fill an entry only when the feed is ok. */
export function isPriceUsable(markOk: boolean, mark: bigint | null): boolean {
  return markOk && mark !== null && mark > 0n;
}
