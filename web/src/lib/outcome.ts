// Pure helpers for call outcomes, records, claims and the leaderboard. No imports.

export type Outcome = "open" | "hit" | "stopped" | "expired";

/** Contract enum: 0 None, 1 Hit, 2 Stopped, 3 Expired. */
export function outcomeFromCode(code: number | bigint): Outcome {
  const n = Number(code);
  return n === 1 ? "hit" : n === 2 ? "stopped" : n === 3 ? "expired" : "open";
}

export const OUTCOME_LABEL: Record<Outcome, string> = { open: "OPEN", hit: "HIT", stopped: "STOPPED", expired: "EXPIRED" };

/**
 * What resolve() would record right now. Mirrors the contract: expiry first, then the mark against the levels.
 * Returns null when nothing can be recorded (price between the levels, or the price is not ok).
 */
export function deriveOutcome(i: {
  isLong: boolean;
  mark: bigint | null;
  markOk: boolean;
  stop: bigint;
  target: bigint;
  /** Seconds since epoch, and the call's expiry in seconds. */
  nowSec: number;
  expiresAtSec: number;
}): Exclude<Outcome, "open"> | null {
  if (i.nowSec >= i.expiresAtSec) return "expired";
  if (!i.markOk || i.mark === null || i.mark <= 0n) return null;
  if (i.isLong) {
    if (i.mark >= i.target) return "hit";
    if (i.mark <= i.stop) return "stopped";
  } else {
    if (i.mark <= i.target) return "hit";
    if (i.mark >= i.stop) return "stopped";
  }
  return null;
}

/** Plain-words reason shown on the "Record the outcome" panel. */
export function resolveCopy(o: Exclude<Outcome, "open">): string {
  if (o === "hit") return "The price reached the target. Record it on chain.";
  if (o === "stopped") return "The price hit the stop. Record it on chain.";
  return "This call has expired. Record it on chain.";
}

export interface RecordCounts {
  hits: number;
  stops: number;
  expired: number;
}

/** Hit rate in percent from hits and stops. Expired calls are not counted. Null when there are none. */
export function hitRate(hits: number, stops: number): number | null {
  const n = hits + stops;
  return n === 0 ? null : (hits / n) * 100;
}

/** "4 hit, 1 stopped, 80% hit rate" or "No resolved calls yet". */
export function recordLine(r: RecordCounts | null): string {
  if (!r || r.hits + r.stops + r.expired === 0) return "No resolved calls yet";
  const parts = [`${r.hits} hit`, `${r.stops} stopped`];
  if (r.expired > 0) parts.push(`${r.expired} expired`);
  const rate = hitRate(r.hits, r.stops);
  if (rate !== null) parts.push(`${Math.round(rate)}% hit rate`);
  return parts.join(", ");
}

/** What a wallet sees for its claim. amount is in 18-decimal USDso. */
export function claimCopy(i: { amount: bigint; isCaller: boolean; outcome: Outcome; usdso: string }): string | null {
  if (i.amount <= 0n || i.outcome === "open") return null;
  if (i.isCaller) return `Your bond comes back: ${i.usdso} USDso.`;
  return `You can claim ${i.usdso} USDso of the caller's bond.`;
}

// ---------- leaderboard ----------

export interface BoardRow {
  caller: string;
  hits: number;
  stops: number;
  expired: number;
  takers: number;
  fees: bigint;
}

/** Callers with at least one resolved call, by hit rate, then takers, then hits. Callers with only expired calls rank last. */
export function rankBoard(rows: BoardRow[]): Array<BoardRow & { rate: number | null }> {
  return rows
    .filter((r) => r.hits + r.stops + r.expired >= 1)
    .map((r) => ({ ...r, rate: hitRate(r.hits, r.stops) }))
    .sort((a, b) => {
      const ra = a.rate ?? -1;
      const rb = b.rate ?? -1;
      if (rb !== ra) return rb - ra;
      if (b.takers !== a.takers) return b.takers - a.takers;
      if (b.hits !== a.hits) return b.hits - a.hits;
      return a.caller.localeCompare(b.caller);
    });
}
