// Server-side loaders that read the chain and return a share card model. Each returns null on a hard failure
// so the image route can fall back to the generic card instead of a 500.
import { loadBoard } from "./board";
import { callCardModel, recordCardModel, takerCardModel, type CardModel } from "./cardmodel";
import { mapLimit, readCall, readCallsOf, readClaimable, readCovered, readHasTaken, readRecord, readResult, readTakes } from "./calls";
import { getMarketMeta } from "./markets";
import { rankBoard } from "./outcome";
import { displayDecimals } from "./prices";
import { pnlPercent, unrealizedPnl, withTimeout } from "./take";
import { makeMarkets } from "./dex";

let fx: ReturnType<typeof makeMarkets> | null = null;

const FAST = { retries: 0, timeoutMs: 4500 };

async function marketOf(pool: string) {
  try {
    return await getMarketMeta(pool, 4500);
  } catch {
    return null;
  }
}

async function loadBase(id: bigint) {
  const r = await readCall(id, { retries: 0, timeoutMs: 6000 });
  if (r.status !== "ok") return null;
  const call = r.call;
  const [m, res, takes] = await Promise.all([marketOf(call.pool), readResult(id, FAST), readTakes(id, FAST)]);
  return { call, m, res, takes, dp: m ? displayDecimals(BigInt(m.tickSize)) : 2 };
}

/** The call card, or the result card once the call is resolved. */
export async function loadCallModel(id: bigint): Promise<CardModel | null> {
  const b = await loadBase(id);
  if (!b) return null;
  const record = await readRecord(b.call.caller as `0x${string}`, { retries: 0, timeoutMs: 3000 });
  return callCardModel({
    id,
    market: b.m?.name ?? "PERP",
    isLong: b.call.isLong,
    entry: b.call.entry,
    stop: b.call.stop,
    target: b.call.target,
    dp: b.dp,
    outcome: b.res?.outcome ?? "open",
    caller: b.call.caller,
    bond: b.res?.bond ?? null,
    capacity: b.call.capacity,
    result: b.res && b.res.outcome !== "open" ? { price: b.res.price, forfeit: b.res.forfeit } : null,
    record,
  });
}

/** The taker card. When the wallet did not take the call, this is the plain call card, so nothing false is claimed. */
export async function loadTakerModel(id: bigint, taker: `0x${string}`): Promise<CardModel | null> {
  const b = await loadBase(id);
  if (!b) return null;
  const [took, covered, claimable] = await Promise.all([readHasTaken(id, taker, FAST), readCovered(id, taker, FAST), readClaimable(id, taker, FAST)]);
  if (took === false || (covered !== null && covered <= 0n && took !== true)) return loadCallModel(id);
  const resolved = b.res && b.res.outcome !== "open";
  const mark = !resolved && b.m && /^\d+$/.test(b.m.markPrice) && BigInt(b.m.markPrice) > 0n ? BigInt(b.m.markPrice) : null;
  // While the call is open, read the taker's live position so the image shows the same P&L as the app.
  let position: { avgEntry: bigint; pnl: bigint; pct: number } | null = null;
  if (!resolved && mark && b.m) {
    try {
      fx ??= makeMarkets();
      const p = await withTimeout(fx.client.getPerpPosition({ marginBank: String(b.m.marginBank).toLowerCase() as `0x${string}`, account: taker, pool: b.call.pool }), 4000);
      if (p.size !== 0n) position = { avgEntry: p.avgEntryPrice, pnl: unrealizedPnl(p.size, p.avgEntryPrice, mark, Number(b.m.baseDecimals)), pct: pnlPercent(p.size, p.avgEntryPrice, mark) };
    } catch {
      /* no live position read: the card falls back to the call's move */
    }
  }
  return takerCardModel({
    id,
    market: b.m?.name ?? "PERP",
    isLong: b.call.isLong,
    entry: b.call.entry,
    stop: b.call.stop,
    target: b.call.target,
    dp: b.dp,
    outcome: b.res?.outcome ?? "open",
    caller: b.call.caller,
    bond: b.res?.bond ?? null,
    capacity: b.call.capacity,
    result: b.res && b.res.outcome !== "open" ? { price: b.res.price, forfeit: b.res.forfeit } : null,
    taker,
    covered,
    totalCovered: b.takes?.covered ?? null,
    claimable,
    mark,
    position,
  });
}

const FEE_SCAN = 40;

/** The caller record card: record counts, calls posted, fees earned (newest FEE_SCAN calls), and the leaderboard rank when the board is cheap to get. */
export async function loadRecordModel(who: `0x${string}`): Promise<CardModel | null> {
  const [record, of] = await Promise.all([readRecord(who, { retries: 0, timeoutMs: 5000 }), readCallsOf(who, { retries: 0, timeoutMs: 5000 })]);
  if (!record) return null;
  const ids = of.status === "ok" ? of.ids : [];
  let fees: bigint | null = null;
  if (of.status === "ok") {
    const t = await mapLimit(ids.slice(0, FEE_SCAN), 6, (i) => readTakes(i, FAST));
    // A failed read must never look like zero fees. Also unknown when there are more calls than were scanned.
    fees = t.some((x) => x === null) || ids.length > FEE_SCAN ? null : t.reduce((a, x) => a + (x?.fees ?? 0n), 0n);
  }
  let rank: { n: number; of: number } | null = null;
  try {
    const board = await withTimeout(loadBoard(), 4000);
    if (board.configured && !board.unreachable && !board.partial) {
      const ranked = rankBoard(board.rows);
      const idx = ranked.findIndex((r) => r.caller.toLowerCase() === who.toLowerCase());
      if (idx >= 0) rank = { n: idx + 1, of: ranked.length };
    }
  } catch {
    /* no rank */
  }
  return recordCardModel({ address: who, record, posted: of.status === "ok" ? ids.length : 0, fees, rank });
}
