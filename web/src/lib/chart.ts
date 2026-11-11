// Pure helpers for the price chart. Prices arrive as raw 18-decimal strings and leave as plain numbers.

export interface RawCandle {
  bucketStart: string;
  openPrice: string;
  high: string;
  low: string;
  closePrice: string;
}

export interface ChartCandle {
  /** Unix seconds. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export const CHART_INTERVALS = [
  { label: "1m", secs: 60 },
  { label: "5m", secs: 300 },
  { label: "1h", secs: 3600 },
] as const;

/** Raw 18-decimal integer string to a number, splitting on the decimal point so no precision is lost early. Null when unusable. */
export function scaleRaw(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const s = raw.padStart(19, "0");
  const n = Number(`${s.slice(0, -18)}.${s.slice(-18)}`);
  return Number.isFinite(n) ? n : null;
}

/** Map indexer candles to chart candles: scale by 1e18, drop bad rows, sort oldest first, one row per time. */
export function mapCandles(raw: RawCandle[]): ChartCandle[] {
  const byTime = new Map<number, ChartCandle>();
  for (const c of raw) {
    const time = Number(c.bucketStart);
    const open = scaleRaw(c.openPrice);
    const high = scaleRaw(c.high);
    const low = scaleRaw(c.low);
    const close = scaleRaw(c.closePrice);
    if (!Number.isFinite(time) || time <= 0 || open === null || high === null || low === null || close === null) continue;
    if (open <= 0 || close <= 0) continue;
    byTime.set(time, { time, open, high: Math.max(high, open, close), low: Math.min(low, open, close), close });
  }
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

/** Add the live mark: update the current bucket, or open a new one when the last candle is older. Returns a new array. */
export function applyLive(candles: ChartCandle[], mark: number | null, nowSec: number, intervalSecs: number): ChartCandle[] {
  if (mark === null || !Number.isFinite(mark) || mark <= 0) return candles;
  const bucket = Math.floor(nowSec / intervalSecs) * intervalSecs;
  const last = candles[candles.length - 1];
  if (last && last.time >= bucket) {
    return [...candles.slice(0, -1), { ...last, high: Math.max(last.high, mark), low: Math.min(last.low, mark), close: mark }];
  }
  const open = last ? last.close : mark;
  return [...candles, { time: bucket, open, high: Math.max(open, mark), low: Math.min(open, mark), close: mark }];
}

/** Seconds since the last trade in the candles, or null when there are none. A bucket ends at its start plus the interval. */
export function lastTradeAgeSec(candles: ChartCandle[], nowSec: number, intervalSecs: number): number | null {
  const last = candles[candles.length - 1];
  if (!last) return null;
  return Math.max(0, nowSec - (last.time + intervalSecs));
}

/** "Last trade 3h ago". Null while the market is trading normally (under two intervals old). */
export function staleLabel(ageSec: number | null, intervalSecs: number): string | null {
  if (ageSec === null || ageSec < intervalSecs * 2) return null;
  if (ageSec < 3600) return `Last trade ${Math.floor(ageSec / 60)}m ago`;
  if (ageSec < 86400) return `Last trade ${Math.floor(ageSec / 3600)}h ago`;
  return `Last trade ${Math.floor(ageSec / 86400)}d ago`;
}

export interface LevelStats {
  /** Percent from the reference price to the stop. Positive means the stop is still ahead. */
  toStopPct: number | null;
  toTargetPct: number | null;
  /** Reward over risk measured from the entry. */
  rewardRisk: number | null;
}

/** Distances from `ref` (the live mark, or the entry before there is one) and reward-to-risk from the entry. Nulls for missing or non-positive inputs. */
export function levelStats(i: { isLong: boolean; entry: number | null; stop: number | null; target: number | null; ref: number | null }): LevelStats {
  const ok = (n: number | null): n is number => n !== null && Number.isFinite(n) && n > 0;
  const ref = ok(i.ref) ? i.ref : ok(i.entry) ? i.entry : null;
  const dir = i.isLong ? 1 : -1;
  const toStopPct = ref !== null && ok(i.stop) ? ((ref - i.stop) / ref) * 100 * dir : null;
  const toTargetPct = ref !== null && ok(i.target) ? ((i.target - ref) / ref) * 100 * dir : null;
  let rewardRisk: number | null = null;
  if (ok(i.entry) && ok(i.stop) && ok(i.target)) {
    const risk = (i.entry - i.stop) * dir;
    const reward = (i.target - i.entry) * dir;
    rewardRisk = risk > 0 && reward > 0 ? reward / risk : null;
  }
  return { toStopPct, toTargetPct, rewardRisk };
}

/** The time of the bar that contains `t`, or null when no bar covers it (before the data, or in a gap with no trades). */
export function snapToBar(times: number[], t: number, intervalSecs: number): number | null {
  let best: number | null = null;
  for (const x of times) if (x <= t && (best === null || x > best)) best = x;
  return best !== null && t < best + intervalSecs ? best : null;
}
