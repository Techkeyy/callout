// Pure price helpers. Prices are bigint quote units with 18 decimals.

export const PRICE_DECIMALS = 18;
const SCALE = 10n ** 18n;

/** "BTC/USDso:USDso" -> "BTC-PERP". */
export function displayName(symbol: string): string {
  const base = symbol.split("/")[0] ?? symbol;
  return `${base}-PERP`;
}

/** Parse a decimal string like "64250.5" into 18-decimal units. Null if it is not a plain positive number. */
export function parsePrice(input: string): bigint | null {
  const s = input.trim().replace(/,/g, "");
  if (!/^\d*\.?\d*$/.test(s) || s === "" || s === ".") return null;
  const [intPart = "0", frac = ""] = s.split(".");
  if (frac.length > PRICE_DECIMALS) return null;
  const raw = BigInt(intPart || "0") * SCALE + BigInt(frac.padEnd(PRICE_DECIMALS, "0") || "0");
  return raw > 0n ? raw : null;
}

/** Format 18-decimal units as a plain decimal string with trailing zeros trimmed. */
export function formatPrice(raw: bigint, maxDp = 18): string {
  const neg = raw < 0n;
  const abs = neg ? -raw : raw;
  const int = abs / SCALE;
  let frac = (abs % SCALE).toString().padStart(PRICE_DECIMALS, "0").slice(0, maxDp);
  frac = frac.replace(/0+$/, "");
  return `${neg ? "-" : ""}${int.toString()}${frac ? "." + frac : ""}`;
}

/** Align down to the tick grid. A tick of 0 or less leaves the price as is. */
export function alignToTick(price: bigint, tick: bigint): bigint {
  if (tick <= 0n) return price;
  return (price / tick) * tick;
}

/** Align to the nearest tick (ties go up). */
export function roundToTick(price: bigint, tick: bigint): bigint {
  if (tick <= 0n) return price;
  return ((price + tick / 2n) / tick) * tick;
}

export function isOnTick(price: bigint, tick: bigint): boolean {
  return tick <= 0n || price % tick === 0n;
}

/** Number of decimals worth showing for a price, from the market's tick size. */
export function displayDecimals(tick: bigint): number {
  if (tick <= 0n) return 2;
  const s = tick.toString().padStart(PRICE_DECIMALS + 1, "0");
  const frac = s.slice(-PRICE_DECIMALS).replace(/0+$/, "");
  return Math.min(frac.length, 8);
}

/** Display a price with a fixed number of decimals and thousands separators. */
export function formatDisplay(raw: bigint, dp = 2): string {
  const s = formatPrice(raw, 18);
  const [i = "0", f = ""] = s.split(".");
  const intFmt = i.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = f.padEnd(dp, "0").slice(0, dp);
  return dp > 0 ? `${intFmt}.${frac}` : intFmt;
}

export function toNumber(raw: bigint): number {
  return Number(formatPrice(raw));
}

export interface CallPrices {
  isLong: boolean;
  entry: bigint | null;
  stop: bigint | null;
  target: bigint | null;
}

export interface Validation {
  ok: boolean;
  /** Plain-words problems. Empty when ok. */
  problems: string[];
}

/** Long: stop < entry < target. Short: target < entry < stop. */
export function validatePrices(c: CallPrices): Validation {
  const problems: string[] = [];
  const { isLong, entry, stop, target } = c;
  if (entry === null) problems.push("Enter an entry price.");
  if (stop === null) problems.push("Enter a stop loss.");
  if (target === null) problems.push("Enter a take profit.");
  if (entry !== null && stop !== null && target !== null) {
    if (isLong) {
      if (stop >= entry) problems.push("For a long, the stop must be below your entry.");
      if (target <= entry) problems.push("For a long, the target must be above your entry.");
    } else {
      if (target >= entry) problems.push("For a short, the target must be below your entry.");
      if (stop <= entry) problems.push("For a short, the stop must be above your entry.");
    }
  }
  return { ok: problems.length === 0, problems };
}

/** Signed percent move from `from` to `to`, e.g. 2.5 means 2.5% above. */
export function pctMove(from: number, to: number): number {
  if (!Number.isFinite(from) || from === 0) return 0;
  return ((to - from) / from) * 100;
}

export interface LadderDistances {
  /** Percent from the mark up or down to the target. Positive means the target is still ahead. */
  toTarget: number;
  /** Percent from the mark to the stop. Positive means the stop is still ahead (not hit). */
  toStop: number;
  targetReached: boolean;
  stopReached: boolean;
}

/** Distances in percent of the mark, with direction-aware "reached" flags. */
export function ladderDistances(isLong: boolean, mark: number, stop: number, target: number): LadderDistances {
  if (!Number.isFinite(mark) || mark === 0) return { toTarget: 0, toStop: 0, targetReached: false, stopReached: false };
  const toTarget = (isLong ? (target - mark) / mark : (mark - target) / mark) * 100;
  const toStop = (isLong ? (mark - stop) / mark : (stop - mark) / mark) * 100;
  return { toTarget, toStop, targetReached: toTarget <= 0, stopReached: toStop <= 0 };
}

export interface LadderScale {
  min: number;
  max: number;
}

/** Scale spanning stop..target (and the mark/entry if they fall outside), with padding as a share of the span. */
export function ladderScale(values: number[], padFrac = 0.18): LadderScale {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return { min: 0, max: 1 };
  let min = Math.min(...finite);
  let max = Math.max(...finite);
  if (max === min) {
    const d = Math.abs(max) * 0.01 || 1;
    min -= d;
    max += d;
  }
  const pad = (max - min) * padFrac;
  return { min: min - pad, max: max + pad };
}

/** Price to y pixel: the higher the price, the smaller y (top of the rail). Clamped to the rail. */
export function priceToY(price: number, scale: LadderScale, height: number, top = 0): number {
  const span = scale.max - scale.min;
  if (span <= 0) return top + height / 2;
  const f = (price - scale.min) / span;
  const clamped = Math.min(1, Math.max(0, f));
  return top + (1 - clamped) * height;
}
