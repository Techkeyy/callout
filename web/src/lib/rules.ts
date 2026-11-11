// The post rules of CallBook v4, mirrored so the composer can say "no" before the wallet is asked.
// The contract is the authority: contracts/src/CallBook.sol (post, _checkLevels). Spec: docs/v4-mechanism.md.
// Pure, no imports.

export const BPS = 10_000n;
/** Stop within 10% of entry. Contract: MAX_STOP_BPS. */
export const MAX_STOP_BPS = 1_000n;
/** Stop at least 0.1% from entry. Contract: MIN_STOP_BPS. */
export const MIN_STOP_BPS = 10n;
/** Entry within 0.5% of the mark at post. Contract: MAX_ENTRY_DRIFT_BPS. */
export const MAX_ENTRY_DRIFT_BPS = 50n;
/** Bond at least 2% of capacity. Contract: BOND_BPS. */
export const BOND_BPS = 200n;
/** The builder fee (10 bps of notional) times this is the notional. Contract: FEE_TO_NOTIONAL. */
export const FEE_TO_NOTIONAL = 1_000n;
/** Longest call. Contract: MAX_DURATION (30 days). */
export const MAX_DURATION_SEC = 30 * 86_400;

const E18 = 10n ** 18n;

function fmt(v: bigint, dp = 2): string {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const scale = 10n ** BigInt(dp);
  const whole = a / E18;
  const frac = ((a % E18) * scale) / E18;
  const f = frac.toString().padStart(dp, "0");
  return `${neg ? "-" : ""}${whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${dp > 0 ? `.${f}` : ""}`;
}

/** The smallest bond for a capacity: the market minimum, or 2% of capacity (rounded up), whichever is more. */
export function minBondFor(capacity: bigint | null, minBond: bigint): bigint {
  if (capacity === null || capacity <= 0n) return minBond;
  const pct = (capacity * BOND_BPS + BPS - 1n) / BPS;
  return pct > minBond ? pct : minBond;
}

export interface PostRuleInput {
  isLong: boolean;
  entry: bigint | null;
  stop: bigint | null;
  target: bigint | null;
  /** The live mark, or null when it is not readable. */
  mark: bigint | null;
  capacity: bigint | null;
  bond: bigint | null;
  minBond: bigint;
  /** Seconds from now until expiry. */
  expirySecs: number;
}

/** Every rule the contract checks at post, in plain words. An empty list means the contract would accept it. */
export function validatePostRules(i: PostRuleInput): string[] {
  const p: string[] = [];
  const { isLong, entry, stop, target, mark } = i;

  if (i.capacity === null || i.capacity <= 0n) p.push("Enter a follower capacity above zero.");
  if (i.bond !== null) {
    const need = minBondFor(i.capacity, i.minBond);
    if (i.bond < i.minBond) p.push(`Your bond must be at least ${fmt(i.minBond, 0)} USDso.`);
    else if (i.capacity !== null && i.capacity > 0n && i.bond < need) {
      p.push(`Your bond must be at least 2% of your capacity: ${fmt(need, 2)} USDso for ${fmt(i.capacity, 0)} USDso of capacity.`);
    }
  }
  if (!(i.expirySecs > 1 && i.expirySecs <= MAX_DURATION_SEC)) p.push("Pick an expiry between a moment from now and 30 days.");

  if (entry === null || stop === null || target === null) return p;
  const ordered = isLong ? stop < entry && entry < target : target < entry && entry < stop;
  if (!ordered) return p; // validatePrices already explains the order

  if (mark === null) {
    p.push("The live price is not readable right now, so your levels cannot be checked. Try again in a moment.");
  } else {
    const around = isLong ? stop < mark && mark < target : target < mark && mark < stop;
    if (!around) {
      p.push(
        isLong
          ? `The live price (${fmt(mark)}) must sit between your stop and your target. A long needs stop below the price, price below target.`
          : `The live price (${fmt(mark)}) must sit between your target and your stop. A short needs target below the price, price below stop.`,
      );
    }
    const drift = entry > mark ? entry - mark : mark - entry;
    if (drift * BPS > mark * MAX_ENTRY_DRIFT_BPS) p.push(`Your entry must be within 0.5% of the live price (${fmt(mark)}).`);
  }

  const risk = isLong ? entry - stop : stop - entry;
  const reward = isLong ? target - entry : entry - target;
  if (risk * BPS > entry * MAX_STOP_BPS) p.push("Your stop is too far from your entry. Keep it within 10%.");
  if (risk * BPS < entry * MIN_STOP_BPS) p.push("Your stop is too close to your entry. Keep it at least 0.1% away.");
  if (reward < risk) p.push("Your target must be at least as far from your entry as your stop is.");
  return p;
}

// ---------- capacity ----------

/** How much more follower notional the bond covers. Never negative. */
export function remainingCapacity(capacity: bigint, covered: bigint): bigint {
  return capacity > covered ? capacity - covered : 0n;
}

export interface CappedSize {
  /** The notional the app will allow. */
  notional: bigint;
  /** True when the wanted size was cut down to what the bond covers. */
  capped: boolean;
}

/** Cap a planned take to what the bond still covers, so nobody takes an uncovered position through the app. */
export function capToRemaining(wanted: bigint, remaining: bigint): CappedSize {
  return wanted > remaining ? { notional: remaining, capped: true } : { notional: wanted, capped: false };
}

// ---------- expiry settlement ----------

/**
 * The bond share that goes to takers when a call expires at `mark`. Mirrors CallBook._settle:
 * forfeit = bond * adverse / stopDistance, where adverse is how far the mark sits beyond the entry on the losing side
 * (0 when the call is in profit or at entry). Only meant for a mark that is inside the levels.
 */
export function forfeitAtExpiry(i: { isLong: boolean; entry: bigint; stop: bigint; mark: bigint; bond: bigint }): bigint {
  const risk = i.isLong ? i.entry - i.stop : i.stop - i.entry;
  if (risk <= 0n) return 0n;
  const adverse = i.isLong ? (i.mark < i.entry ? i.entry - i.mark : 0n) : i.mark > i.entry ? i.mark - i.entry : 0n;
  if (adverse >= risk) return i.bond; // past the stop it would be STOPPED, which forfeits the whole bond
  return (i.bond * adverse) / risk;
}

/** Whole percent of the bond that goes to takers, rounded to nearest. 0 when the bond is 0. */
export function forfeitPercent(forfeit: bigint, bond: bigint): number {
  if (bond <= 0n) return 0;
  return Math.round(Number((forfeit * 10_000n) / bond) / 100);
}

/** The bond the composer starts from: the smallest allowed bond, rounded up to a whole cent so it reads cleanly. */
export function defaultBond(capacity: bigint | null, minBond: bigint): bigint {
  const need = minBondFor(capacity, minBond);
  const cent = E18 / 100n;
  return ((need + cent - 1n) / cent) * cent;
}
