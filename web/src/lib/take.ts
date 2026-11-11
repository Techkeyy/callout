// Pure helpers for taking a call. No chain access, no imports: safe in the browser, in vitest and in plain node.
// Prices are 18-decimal raw integers. Quantities are raw base units (BTC has 8 decimals).

export const FEE_BPS_TIMES_1K = 10000n; // 10 bps cap, the most a caller can earn on a fill
export const TAG_PREFIX = 0xca11n;
export const U64_MAX = 2n ** 64n - 1n;
export const MIN_STT_FOR_TAKE = 4n * 10n ** 17n; // 0.4 STT: gas for the order plus 0.30 STT locked on the stop and target
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
export const IOC = 2;

/** userData tag stored on the order: (0xCA11 << 48) | callId. */
export function cardTag(callId: bigint): bigint {
  return (TAG_PREFIX << 48n) | callId;
}

export function tagCallId(tag: bigint): bigint | null {
  return tag >> 48n === TAG_PREFIX ? tag & ((1n << 48n) - 1n) : null;
}

/**
 * Worst price an IOC order may fill at: mark +1% for a buy, mark -1% for a sell, aligned to the tick.
 * A buy rounds up and a sell rounds down so the bound never sits inside the 1% band.
 */
export function crossingPrice(mark: bigint, tick: bigint, isBid: boolean): bigint {
  const raw = isBid ? (mark * 101n) / 100n : (mark * 99n) / 100n;
  if (tick <= 0n) return raw;
  return isBid ? ((raw + tick - 1n) / tick) * tick : (raw / tick) * tick;
}

function abs(n: bigint): bigint {
  return n < 0n ? -n : n;
}

/** Notional value (18 decimals) of a raw base quantity at a price. */
export function notionalOf(quantity: bigint, price: bigint, baseDecimals: number): bigint {
  return (abs(quantity) * price) / 10n ** BigInt(baseDecimals);
}

export interface SizeRules {
  baseDecimals: number;
  lotSize: bigint;
  minQuantity: bigint;
  /** Largest placeable quantity from the chain, or null when unknown. */
  maxQuantity: bigint | null;
}

/** Quantity for a notional target: aligned down to the lot, never below the minimum, never above the max. */
export function notionalToQuantity(notional: bigint, price: bigint, r: SizeRules): bigint {
  if (price <= 0n) return 0n;
  let q = (notional * 10n ** BigInt(r.baseDecimals)) / price;
  if (r.lotSize > 0n) q = (q / r.lotSize) * r.lotSize;
  if (q < r.minQuantity) q = r.minQuantity;
  if (r.maxQuantity !== null && q > r.maxQuantity) {
    q = r.lotSize > 0n ? (r.maxQuantity / r.lotSize) * r.lotSize : r.maxQuantity;
  }
  return q;
}

/** True when the quantity is a legal order size. */
export function isLegalQuantity(q: bigint, r: SizeRules): boolean {
  if (q < r.minQuantity) return false;
  if (r.lotSize > 0n && q % r.lotSize !== 0n) return false;
  if (r.maxQuantity !== null && q > r.maxQuantity) return false;
  return true;
}

/** What the caller earns on a fill: 0.1% of notional at the 10 bps cap. */
export function callerFee(notional: bigint, feeBpsTimes1k: bigint = FEE_BPS_TIMES_1K): bigint {
  return (notional * feeBpsTimes1k) / 10_000_000n;
}

/** Unrealized profit or loss in quote units (18 decimals) for a signed size (positive long, negative short). */
export function unrealizedPnl(size: bigint, avgEntry: bigint, mark: bigint, baseDecimals: number): bigint {
  return (size * (mark - avgEntry)) / 10n ** BigInt(baseDecimals);
}

/** Percent move in the position's favour (negative when losing), for display. */
export function pnlPercent(size: bigint, avgEntry: bigint, mark: bigint): number {
  if (avgEntry <= 0n || size === 0n) return 0;
  const diff = Number(mark - avgEntry) / Number(avgEntry);
  return (size > 0n ? diff : -diff) * 100;
}

export const DEFAULT_IMF_BPS = 2000n; // 20%, used only when the chain value cannot be read

/**
 * Initial margin for a DESIRED notional: ceil(notional x imfBps / 10000) plus a 5% buffer for price moves.
 * Never derived from the chain's max order size, which is 0 for an account with no margin.
 */
export function requiredMargin(notional: bigint, imfBps: bigint = DEFAULT_IMF_BPS): bigint {
  const base = (notional * imfBps + 9999n) / 10000n;
  return base + base / 20n;
}

export const DEFAULT_MM_BPS = 125n; // 1.25%, used only when the maintenance margin cannot be read

/**
 * Margin that keeps the liquidation price beyond the call stop: notional x (distance to stop + maintenance margin + 2%).
 * The distance is measured from the live mark, which is where the position enters.
 */
export function stopSafeMargin(notional: bigint, mark: bigint, stop: bigint, mmBps: bigint = DEFAULT_MM_BPS): bigint {
  if (mark <= 0n) return 0n;
  const dist = mark > stop ? mark - stop : stop - mark;
  const distBps = (dist * 10000n + mark - 1n) / mark;
  return (notional * (distBps + mmBps + 200n) + 9999n) / 10000n;
}

/** What a take must lock: the larger of the initial-margin requirement and the stop-safe amount. */
export function marginForTake(notional: bigint, imfBps: bigint | undefined, mark: bigint, stop: bigint, mmBps?: bigint): bigint {
  const a = requiredMargin(notional, imfBps);
  const b = stopSafeMargin(notional, mark, stop, mmBps);
  return a > b ? a : b;
}

/** True when the call stop triggers before the position would be liquidated. A null price means no liquidation. */
export function stopBeforeLiquidation(isLong: boolean, stop: bigint, liquidation: bigint | null): boolean {
  if (liquidation === null) return true;
  return isLong ? liquidation < stop : liquidation > stop;
}

// ---------- what blocks a take ----------

export type BlockReason = "closed" | "expired" | "stopHit" | "targetHit" | "isCaller" | "wrongNetwork";

export const BLOCK_COPY: Record<BlockReason, string> = {
  closed: "The caller closed this call. It can no longer be taken.",
  expired: "This call has expired. It can no longer be taken.",
  stopHit: "This call already hit its stop, so it can no longer be taken.",
  targetHit: "This call already reached its target, so it can no longer be taken.",
  isCaller: "This is your call. Share the link so others can take it.",
  wrongNetwork: "Your wallet is on a different network. Switch to Somnia Tokyo to continue.",
};

export function blockReason(i: {
  status: "open" | "expired" | "closed";
  isCaller: boolean;
  wrongNetwork: boolean;
  isLong: boolean;
  mark: bigint | null;
  stop: bigint;
  target: bigint;
}): BlockReason | null {
  if (i.status === "closed") return "closed";
  if (i.status === "expired") return "expired";
  if (i.isCaller) return "isCaller";
  if (i.mark !== null) {
    if (i.isLong ? i.mark <= i.stop : i.mark >= i.stop) return "stopHit";
    if (i.isLong ? i.mark >= i.target : i.mark <= i.target) return "targetHit";
  }
  if (i.wrongNetwork) return "wrongNetwork";
  return null;
}

// ---------- which step the user is on ----------

export type Step = "connect" | "gas" | "margin" | "approve" | "take" | "in";

export const STEP_ORDER: Step[] = ["connect", "gas", "margin", "approve", "take"];

export function deriveStep(i: {
  connected: boolean;
  stt: bigint | null;
  /** Free collateral in the margin bank. */
  margin: bigint | null;
  /** Margin needed for the chosen size. */
  marginNeeded: bigint;
  approval: bigint | null;
  hasPosition: boolean;
}): Step {
  if (!i.connected) return "connect";
  if (i.hasPosition) return "in";
  if (i.stt === null || i.margin === null || i.approval === null) return "connect";
  if (i.stt < MIN_STT_FOR_TAKE) return "gas";
  if (i.margin < i.marginNeeded) return "margin";
  if (i.approval < FEE_BPS_TIMES_1K) return "approve";
  return "take";
}

/** The voucher is only offered when the chain says the wallet is eligible AND a simulated claim succeeds. */
export function voucherUsable(eligible: boolean, claimSimulates: boolean): boolean {
  return eligible && claimSimulates;
}

export const CLAIM_REFUSED_COPY =
  "dreamDEX did not accept the practice USDso claim for this wallet. Nothing changed. Use the dreamDEX testnet app to get USDso.";
export const NEED_USDSO_COPY = "You need some testnet USDso. Get practice USDso in the dreamDEX testnet app (Perps Arena), then come back.";

/** What to offer when margin is short. */
export type MarginPlan = "deposit" | "voucher" | "external";

export function marginPlan(i: { walletUsdso: bigint; shortfall: bigint; voucherEligible: boolean }): MarginPlan {
  if (i.walletUsdso >= i.shortfall && i.shortfall > 0n) return "deposit";
  if (i.voucherEligible) return "voucher";
  return "external";
}

// ---------- plain-words errors ----------

export type TakeError = { kind: "rejected" } | { kind: "error"; message: string };

export function describeTakeError(err: unknown): TakeError {
  const e = err as { shortMessage?: string; message?: string; name?: string; code?: number; cause?: unknown };
  if (e?.message === CLAIM_REFUSED_COPY) return { kind: "error", message: CLAIM_REFUSED_COPY };
  let text = `${e?.shortMessage ?? ""} ${e?.message ?? ""}`;
  let c: unknown = e?.cause;
  let rejected = e?.code === 4001 || e?.name === "UserRejectedRequestError";
  for (let n = 0; c && n < 6; n++) {
    const o = c as { shortMessage?: string; message?: string; name?: string; code?: number; cause?: unknown };
    text += ` ${o.shortMessage ?? ""} ${o.message ?? ""}`;
    if (o.code === 4001 || o.name === "UserRejectedRequestError") rejected = true;
    c = o.cause;
  }
  if (rejected || /user rejected|denied transaction|rejected the request/i.test(text)) return { kind: "rejected" };
  if (/ImmediateOrCancelNoFill/i.test(text)) {
    return { kind: "error", message: "Nobody was trading at that price, nothing changed. Try again." };
  }
  if (/insufficient funds/i.test(text)) {
    return { kind: "error", message: "Your wallet has no STT for gas. Get testnet STT, then try again." };
  }
  if (/voucherBlocked/i.test(text)) {
    return { kind: "error", message: "Practice USDso cannot be used on this market. Deposit real test USDso instead." };
  }
  return { kind: "error", message: "Something went wrong. Nothing was taken. Try again in a moment." };
}
