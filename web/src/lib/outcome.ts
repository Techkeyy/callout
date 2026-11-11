// Pure helpers for call outcomes, records, claims and the leaderboard. No imports.

export type Outcome = "open" | "hit" | "stopped" | "expired";

/** Contract enum: 0 None, 1 Hit, 2 Stopped, 3 Expired. */
export function outcomeFromCode(code: number | bigint): Outcome {
  const n = Number(code);
  return n === 1 ? "hit" : n === 2 ? "stopped" : n === 3 ? "expired" : "open";
}

export const OUTCOME_LABEL: Record<Outcome, string> = { open: "OPEN", hit: "HIT", stopped: "STOPPED", expired: "EXPIRED" };

/**
 * What resolve() would record right now. Mirrors CallBook._settle, price before clock:
 * read the mark; past the stop is STOPPED; else past the target is HIT; else at or after expiry it is EXPIRED; else nothing.
 * Returns null when nothing can be recorded (price between the levels before expiry, or the price is not readable).
 * An unreadable price blocks even an expiry, as on chain: a late resolve must not guess the price.
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
  if (!i.markOk || i.mark === null || i.mark <= 0n) return null;
  const pastStop = i.isLong ? i.mark <= i.stop : i.mark >= i.stop;
  const pastTarget = i.isLong ? i.mark >= i.target : i.mark <= i.target;
  if (pastStop) return "stopped";
  if (pastTarget) return "hit";
  if (i.nowSec >= i.expiresAtSec) return "expired";
  return null;
}

/** Plain-words reason shown on the "Record the outcome" panel. */
export function resolveCopy(o: Exclude<Outcome, "open">): string {
  if (o === "hit") return "The price reached the target. Record it on chain.";
  if (o === "stopped") return "The price hit the stop. Record it on chain.";
  return "This call has expired. Record it on chain. It settles at the current price.";
}

/** The line under an expired call: where it settled and who gets what. Prices are already formatted. */
export function settlementLine(i: { outcome: Outcome; priceText: string; forfeit: bigint; bond: bigint; covered: bigint | null }): string | null {
  if (i.outcome !== "expired") return null;
  if (i.forfeit <= 0n) return "Expired in profit. Bond back.";
  if (i.covered !== null && i.covered <= 0n) return `Expired at ${i.priceText}. Nobody took the call, so the bond is back.`;
  const pct = i.bond > 0n ? Math.round(Number((i.forfeit * 10_000n) / i.bond) / 100) : 0;
  return `Expired at ${i.priceText}. ${pct < 1 ? "Under 1%" : `${pct}%`} of the bond to takers.`;
}

export interface RecordCounts {
  hits: number;
  stops: number;
  /** Every expired call, in profit or at a loss. */
  expired: number;
  /** Expired with the price on the losing side. These count as misses. */
  expiredLosses: number;
}

/** Hit rate in percent: hits / (hits + stops + expired losses). Expiries in profit are neutral. Null when there is nothing to judge. */
export function hitRate(hits: number, stops: number, expiredLosses = 0): number | null {
  const n = hits + stops + expiredLosses;
  return n === 0 ? null : (hits / n) * 100;
}

/** "4 hit, 1 stopped, 2 expired (1 at a loss), 67% hit rate" or "No resolved calls yet". */
export function recordLine(r: RecordCounts | null): string {
  if (!r || r.hits + r.stops + r.expired === 0) return "No resolved calls yet";
  const parts = [`${r.hits} hit`, `${r.stops} stopped`];
  if (r.expired > 0) parts.push(r.expiredLosses > 0 ? `${r.expired} expired (${r.expiredLosses} at a loss)` : `${r.expired} expired`);
  const rate = hitRate(r.hits, r.stops, r.expiredLosses);
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
  expiredLosses: number;
  takers: number;
  fees: bigint;
}

/** Callers with at least one resolved call, by hit rate, then takers, then hits. Callers with only expiries in profit have no rate and rank last. */
export function rankBoard(rows: BoardRow[]): Array<BoardRow & { rate: number | null }> {
  return rows
    .filter((r) => r.hits + r.stops + r.expired >= 1)
    .map((r) => ({ ...r, rate: hitRate(r.hits, r.stops, r.expiredLosses) }))
    .sort((a, b) => {
      const ra = a.rate ?? -1;
      const rb = b.rate ?? -1;
      if (rb !== ra) return rb - ra;
      if (b.takers !== a.takers) return b.takers - a.takers;
      if (b.hits !== a.hits) return b.hits - a.hits;
      return a.caller.localeCompare(b.caller);
    });
}
