// The view model behind every share card. The same model feeds the 1200x630 image (src/lib/ogcard.tsx)
// and the animated HTML card (src/components/ShareCard.tsx), so they cannot drift apart. Pure.
import { formatDisplay } from "./prices";
import { hitRate, OUTCOME_LABEL, type Outcome, type RecordCounts } from "./outcome";
import { forfeitPercent } from "./rules";
import { callShareText, fmtMove, moveDp, movePct, recordShareText, resultShareText, takerPayout, takerShareText } from "./share";
import { shortAddress } from "./time";

export type CardKind = "call" | "result" | "taker" | "record";
export type Tone = "ink" | "long" | "short" | "signal";

/** A number that counts up in the app. `v` is always the final text. */
export interface Num {
  to: number;
  dp: number;
  plus?: boolean;
  suffix?: string;
}
export interface Stat {
  k: string;
  v: string;
  tone?: Tone;
  num?: Num;
}
export interface Foot {
  k: string;
  v: string;
  v2?: string | null;
}
export interface CardModel {
  kind: CardKind;
  stamp: string;
  tone: Tone;
  eyebrow: string;
  headline: string;
  sub: string | null;
  subTone: Tone;
  big: (Stat & { note?: string | null }) | null;
  cells: Stat[];
  footL: Foot;
  footR: Foot;
  /** Pre-written share text. */
  text: string;
  /** Page path the share links to. */
  path: string;
  /** PNG path (the Open Graph image of that page). */
  imagePath: string;
  /** Used in the download file name. */
  fileId: string;
}

const E18 = 10n ** 18n;
/** Whole amounts without decimals, otherwise two. */
export const usd = (v: bigint) => formatDisplay(v, v % E18 === 0n ? 0 : 2);
const usdNum = (v: bigint): Num => ({ to: Number(usd(v).replace(/,/g, "")), dp: v % E18 === 0n ? 0 : 2, suffix: " USDso" });
const usdStat = (k: string, v: bigint, tone?: Tone): Stat => ({ k, v: `${usd(v)} USDso`, tone, num: usdNum(v) });

function moveStat(label: string, p: number | null): (Stat & { note?: string | null }) | null {
  if (p === null) return null;
  const to = Number(p.toFixed(moveDp(p)));
  return { k: label, v: fmtMove(p), tone: to > 0 ? "long" : to < 0 ? "short" : "ink", num: { to, dp: moveDp(p), plus: true, suffix: "%" } };
}

export interface CallCardInput {
  id: bigint | string;
  market: string;
  isLong: boolean;
  entry: bigint;
  stop: bigint;
  target: bigint;
  dp: number;
  outcome: Outcome;
  caller: string;
  /** 18-decimal USDso. */
  bond: bigint | null;
  capacity: bigint | null;
  /** The call's recorded result, when resolved. */
  result: { price: bigint; forfeit: bigint } | null;
  record: RecordCounts | null;
}

/** A short record line for a card footer: "3 hits, 1 stop, 75% hit rate". Null when nothing is resolved. */
export function compactRecord(r: RecordCounts | null): string | null {
  if (!r || r.hits + r.stops + r.expired === 0) return null;
  const rate = hitRate(r.hits, r.stops, r.expiredLosses);
  return `${r.hits} ${r.hits === 1 ? "hit" : "hits"}, ${r.stops} ${r.stops === 1 ? "stop" : "stops"}${rate === null ? "" : `, ${Math.round(rate)}% hit rate`}`;
}

/** The call card while open, the result card once resolved. */
export function callCardModel(i: CallCardInput): CardModel {
  const id = i.id.toString();
  const side = i.isLong ? "LONG" : "SHORT";
  const sideTone: Tone = i.isLong ? "long" : "short";
  const f = (v: bigint) => formatDisplay(v, i.dp);
  const bond = i.bond && i.bond > 0n ? i.bond : null;
  const base = {
    path: `/c/${id}`,
    imagePath: `/c/${id}/opengraph-image`,
    fileId: id,
    eyebrow: `Call #${id}`,
    footL: { k: "Caller", v: shortAddress(i.caller), v2: compactRecord(i.record) } as Foot,
    footR: (bond ? { k: "Bond", v: `${usd(bond)} USDso`, v2: i.capacity ? `${usd(i.capacity)} USDso capacity` : null } : { k: "Bond", v: "On chain" }) as Foot,
  };
  const levels: Stat[] = [
    { k: "Entry", v: f(i.entry) },
    { k: "Stop", v: f(i.stop), tone: "short" },
    { k: "Target", v: f(i.target), tone: "long" },
  ];
  const callText = callShareText({ market: i.market, isLong: i.isLong, entry: f(i.entry), stop: f(i.stop), target: f(i.target), bond: bond ? usd(bond) : null });

  if (i.outcome === "open" || !i.result) {
    return { ...base, kind: "call", stamp: OUTCOME_LABEL.open, tone: "ink", headline: i.market, sub: side, subTone: sideTone, big: null, cells: levels, text: callText };
  }

  const r = i.result;
  const move = movePct(i.isLong, i.entry, r.price);
  const big = moveStat("Call move", move);
  const pct = bond ? forfeitPercent(r.forfeit, bond) : 0;
  const text = resultShareText({ outcome: i.outcome, isLong: i.isLong, market: i.market, move: move === null ? null : fmtMove(move), bond: bond ? usd(bond) : null, forfeitPct: pct, forfeit: r.forfeit });
  const sub = `${side} ${i.market}`;
  const resolved: Stat = { k: "Resolved at", v: f(r.price) };
  if (i.outcome === "hit") {
    return { ...base, kind: "result", stamp: "HIT", tone: "long", headline: "Called it.", sub, subTone: sideTone, big: big && { ...big, note: "Bond returned." }, cells: [levels[0], resolved, ...(bond ? [usdStat("Bond", bond)] : [])], text };
  }
  if (i.outcome === "stopped") {
    return { ...base, kind: "result", stamp: "STOPPED", tone: "short", headline: "Paid my takers.", sub, subTone: sideTone, big: big && { ...big, note: `${usd(r.forfeit)} USDso bond to takers` }, cells: [levels[0], resolved, usdStat("Bond to takers", r.forfeit, "short")], text };
  }
  const inProfit = r.forfeit <= 0n;
  const expiredNote = inProfit ? "Expired in profit. Bond back." : bond ? `${pct < 1 ? "Under 1%" : `${pct}%`} of the bond to takers.` : "Part of the bond to takers.";
  return {
    ...base,
    kind: "result",
    stamp: "EXPIRED",
    tone: "ink",
    headline: inProfit ? "Expired in profit." : "Settled at the price.",
    sub,
    subTone: sideTone,
    big: big && { ...big, note: expiredNote },
    cells: [levels[0], resolved, ...(!inProfit ? [usdStat("Bond to takers", r.forfeit, "short")] : bond ? [usdStat("Bond", bond)] : [])],
    text,
  };
}

export interface TakerCardInput extends Omit<CallCardInput, "record"> {
  taker: string;
  /** The follower's covered size, 18-decimal. Null when it could not be read. */
  covered: bigint | null;
  /** Everything covered on the call. */
  totalCovered: bigint | null;
  /** What the taker can claim now. Null when unknown. */
  claimable: bigint | null;
  /** The mark while the call is open, or null. */
  mark: bigint | null;
  /** The taker's live position, when they still hold it: their own entry and unrealized P&L (signed, 18-decimal USDso). */
  position?: { avgEntry: bigint; pnl: bigint; pct: number } | null;
  /** The taker's closed trade, already verified against the chain (their own entry, exit and the protocol's realized P&L). */
  closed?: { entry: bigint; exit: bigint; realizedPnl: bigint; pct: number; closeTx: string } | null;
}

/** The bond payout a taker got (or can claim), or null when there is none. */
export function takerPayoutOf(i: Pick<TakerCardInput, "outcome" | "result" | "covered" | "totalCovered" | "claimable">): bigint | null {
  if (i.outcome === "open" || !i.result || i.result.forfeit <= 0n) return null;
  let p: bigint | null = null;
  if (i.claimable !== null && i.claimable > 0n) p = i.claimable;
  else if (i.covered !== null && i.totalCovered !== null) p = takerPayout(i.result.forfeit, i.covered, i.totalCovered);
  return p !== null && p > 0n ? p : null;
}

/**
 * The taker card. While the taker still holds the position it leads with their real P&L (the same
 * number the app shows), with the call's move as the second line. Once closed or settled it shows the
 * call's move and the bond payout. Every number is labelled for what it is.
 */
export function takerCardModel(i: TakerCardInput): CardModel {
  const id = i.id.toString();
  const f = (v: bigint) => formatDisplay(v, i.dp);
  const resolved = i.outcome !== "open" && !!i.result;
  const to = resolved ? i.result!.price : i.mark;
  const move = to ? movePct(i.isLong, i.entry, to) : null;
  let big: (Stat & { note?: string | null }) | null = moveStat(resolved ? "Call move" : "Call move so far", move);
  const forfeit = resolved ? i.result!.forfeit : 0n;
  const payout = takerPayoutOf(i);
  const stamp = resolved ? OUTCOME_LABEL[i.outcome] : "TAKEN";
  const tone: Tone = !resolved ? "signal" : i.outcome === "hit" ? "long" : i.outcome === "stopped" ? "short" : "ink";
  const note = !resolved ? "Call still open." : payout ? "The bond paid me." : forfeit > 0n ? "The bond went to takers." : i.outcome === "hit" ? "Target reached." : "Expired in profit.";
  const cells: Stat[] = [
    { k: "Entry", v: f(i.entry) },
    resolved ? { k: "Resolved at", v: f(i.result!.price) } : i.mark ? { k: "Mark", v: f(i.mark) } : { k: "Target", v: f(i.target), tone: "long" },
    i.covered !== null && i.covered > 0n ? usdStat("My covered size", i.covered) : { k: "My covered size", v: "-" },
  ];
  const callerShort = shortAddress(i.caller);
  const live = !resolved && i.position ? i.position : null;
  if (live) {
    const pnlAbs = live.pnl < 0n ? -live.pnl : live.pnl;
    const pnlTone: Tone = live.pnl > 0n ? "long" : live.pnl < 0n ? "short" : "ink";
    const mine = moveStat("My P&L, live", live.pct);
    big = mine && { ...mine, note: move === null ? "Call still open." : `Call move ${fmtMove(move)} so far.` };
    cells.splice(0, cells.length, { k: "My entry", v: f(live.avgEntry) }, i.mark ? { k: "Mark", v: f(i.mark) } : { k: "Target", v: f(i.target), tone: "long" }, { k: "My P&L", v: `${live.pnl > 0n ? "+" : live.pnl < 0n ? "-" : ""}$${formatDisplay(pnlAbs, 2)}`, tone: pnlTone });
  }
  if (i.closed) {
    const c = i.closed;
    const ctone: Tone = c.realizedPnl > 0n ? "long" : c.realizedPnl < 0n ? "short" : "ink";
    const abs = c.realizedPnl < 0n ? -c.realizedPnl : c.realizedPnl;
    const signed = `${c.realizedPnl > 0n ? "+" : c.realizedPnl < 0n ? "-" : ""}$${formatDisplay(abs, 2)}`;
    const mine = moveStat("My realized P&L", c.pct);
    return {
      kind: "taker",
      stamp: "CLOSED",
      tone: ctone,
      eyebrow: `Call #${id}`,
      headline: "I closed my take",
      sub: `${i.isLong ? "LONG" : "SHORT"} ${i.market}`,
      subTone: i.isLong ? "long" : "short",
      big: mine && { ...mine, note: `Closed at ${f(c.exit)}` },
      cells: [{ k: "My entry", v: f(c.entry) }, { k: "My exit", v: f(c.exit) }, { k: "Realized", v: signed, tone: ctone }],
      footL: { k: "Taker", v: shortAddress(i.taker) },
      footR: payout ? { k: "Bond payout", v: `${usd(payout)} USDso` } : { k: "Caller", v: callerShort },
      text: `closed my take on ${callerShort}'s call: ${fmtMove(c.pct)} realized (${signed}). callout:`,
      path: `/c/${id}/taker/${i.taker}?close=${c.closeTx}`,
      imagePath: `/c/${id}/taker/${i.taker}/image?close=${c.closeTx}`,
      fileId: `${id}-${i.taker.slice(2, 8).toLowerCase()}-closed`,
    };
  }
  return {
    kind: "taker",
    stamp,
    tone,
    eyebrow: `Call #${id}`,
    headline: `I took ${callerShort}'s call`,
    sub: `${i.isLong ? "LONG" : "SHORT"} ${i.market}`,
    subTone: i.isLong ? "long" : "short",
    big: big && (live ? big : { ...big, note }),
    cells,
    footL: { k: "Taker", v: shortAddress(i.taker) },
    footR: payout ? { k: "Bond payout", v: `${usd(payout)} USDso` } : { k: "Caller", v: callerShort },
    text: live
      ? `took ${callerShort}'s call on callout. i'm ${fmtMove(live.pct)} on it so far, stop and target armed.`
      : takerShareText({ caller: callerShort, move: move === null ? null : fmtMove(move), open: !resolved, payout: payout ? usd(payout) : null }),
    path: `/c/${id}/taker/${i.taker}`,
    imagePath: `/c/${id}/taker/${i.taker}/opengraph-image`,
    fileId: `${id}-${i.taker.slice(2, 8).toLowerCase()}`,
  };
}

export interface RecordCardInput {
  address: string;
  record: RecordCounts;
  posted: number;
  /** 18-decimal USDso, or null when it could not be read in full. */
  fees: bigint | null;
  /** 1-based rank and how many are ranked, or null. */
  rank: { n: number; of: number } | null;
}

export function recordCardModel(i: RecordCardInput): CardModel {
  const r = i.record;
  const rate = hitRate(r.hits, r.stops, r.expiredLosses);
  const rounded = rate === null ? null : Math.round(rate);
  const cells: Stat[] = [
    { k: "Hits", v: String(r.hits), tone: r.hits > 0 ? "long" : undefined, num: { to: r.hits, dp: 0 } },
    { k: "Stops", v: String(r.stops), tone: r.stops > 0 ? "short" : undefined, num: { to: r.stops, dp: 0 } },
    { k: "Expired losses", v: String(r.expiredLosses), num: { to: r.expiredLosses, dp: 0 } },
    { k: "Calls posted", v: String(i.posted), num: { to: i.posted, dp: 0 } },
    i.fees === null ? { k: "Fees earned", v: "-" } : usdStat("Fees earned", i.fees),
  ];
  return {
    kind: "record",
    stamp: "RECORD",
    tone: "signal",
    eyebrow: "On chain",
    headline: "My Callout record",
    sub: shortAddress(i.address),
    subTone: "ink",
    big:
      rounded === null
        ? { k: "Hit rate", v: "-", tone: "ink", note: "No resolved calls yet." }
        : { k: "Hit rate", v: `${rounded}%`, tone: rounded >= 50 ? "long" : "short", num: { to: rounded, dp: 0, suffix: "%" }, note: "Every call on chain. No edits." },
    cells,
    footL: { k: "Wallet", v: shortAddress(i.address) },
    footR: { k: "Rank", v: i.rank ? `#${i.rank.n} of ${i.rank.of}` : "Not ranked" },
    text: recordShareText({ hits: r.hits, stops: r.stops, expiredLosses: r.expiredLosses, rate }),
    path: `/u/${i.address}`,
    imagePath: `/u/${i.address}/opengraph-image`,
    fileId: i.address.slice(2, 8).toLowerCase(),
  };
}

/** The generic card, used when a read fails. */
export function fallbackModel(): CardModel {
  return {
    kind: "call",
    stamp: "OPEN",
    tone: "ink",
    eyebrow: "Callout",
    headline: "Call it. Back it. Prove it.",
    sub: null,
    subTone: "ink",
    big: null,
    cells: [],
    footL: { k: "Where", v: "Somnia Tokyo testnet" },
    footR: { k: "Proof", v: "On chain" },
    text: "callout: call it, back it with a bond, prove it on chain.",
    path: "/",
    imagePath: "/opengraph-image",
    fileId: "callout",
  };
}
