import { SomniaMarkets, SOMNIA_HIDEKI_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { INDEXER_URL, WS_URL, somniaTokyo } from "./chain";
import { parseLiveState } from "./mark";
import { displayName } from "./prices";
import { withTimeout } from "./take";

/** One perp market. Price fields are 18-decimal raw integers as strings (the SDK already returns raw units). */
export interface MarketRow {
  pool: string;
  symbol: string;
  name: string;
  /** Live on-chain mark when `markOk`, otherwise the last indexer snapshot (never to be shown as live). */
  markPrice: string;
  indexPrice: string;
  /** False when the feed is stale or the live read failed. Treat the market as unpriceable. */
  markOk: boolean;
  /** Server time (ms) when the chain was read. */
  readAt: number;
  tickSize: string;
  marginBank: string;
  stopRegistry: string;
  quoteToken: string;
  minQuantity: string;
  lotSize: string;
  baseDecimals: number;
}

type StaticRow = Omit<MarketRow, "indexPrice" | "markOk" | "readAt">;

const STATIC_TTL_MS = 5 * 60 * 1000;
const LIVE_TTL_MS = 3000;
const LIVE_TIMEOUT_MS = 6000;

let fx: SomniaMarkets | null = null;
function client(): SomniaMarkets {
  if (!fx) {
    fx = new SomniaMarkets({
      chain: somniaTokyo,
      indexerUrl: INDEXER_URL,
      wsRpcUrl: WS_URL,
      addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES,
    } as never);
  }
  return fx;
}

// ---------- static metadata (cached for minutes) ----------

let staticCache: { at: number; rows: StaticRow[] } | null = null;
let staticInflight: Promise<StaticRow[]> | null = null;

async function loadStatic(): Promise<StaticRow[]> {
  const all = await client().loadMarkets(true);
  const rows: StaticRow[] = [];
  for (const m of Object.values(all) as Array<{ type: string; symbol: string; info: Record<string, unknown> }>) {
    if (m.type !== "swap") continue;
    const i = m.info;
    // Skip test or dead markets: a usable market has integer mark and tick values.
    if (!/^\d+$/.test(String(i.markPrice)) || !/^\d+$/.test(String(i.tickSize)) || BigInt(String(i.markPrice)) === 0n) continue;
    if (/^LOADTEST/i.test(m.symbol)) continue;
    rows.push({
      pool: String(i.poolAddress),
      symbol: m.symbol,
      name: displayName(m.symbol),
      markPrice: String(i.markPrice),
      tickSize: String(i.tickSize),
      marginBank: String(i.marginBank),
      stopRegistry: String(i.stopRegistry),
      quoteToken: String(i.quoteToken),
      minQuantity: String(i.minQuantity),
      lotSize: String(i.lotSize),
      baseDecimals: Number(i.baseDecimals),
    });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}

async function getStatic(): Promise<StaticRow[]> {
  if (staticCache && Date.now() - staticCache.at < STATIC_TTL_MS) return staticCache.rows;
  if (!staticInflight) {
    staticInflight = loadStatic()
      .then((rows) => {
        staticCache = { at: Date.now(), rows };
        return rows;
      })
      .finally(() => {
        staticInflight = null;
      });
  }
  try {
    return await staticInflight;
  } catch (e) {
    if (staticCache) return staticCache.rows;
    throw e;
  }
}

// ---------- live mark (cached for seconds) ----------

interface Live {
  markPrice: string;
  indexPrice: string;
  markOk: boolean;
  readAt: number;
}
const liveCache = new Map<string, { at: number; live: Live }>();
const liveInflight = new Map<string, Promise<Live | null>>();

/** The authoritative mark: getPerpState(pool), not the indexer snapshot that loadMarkets returns. */
async function getLive(pool: string): Promise<Live | null> {
  const hit = liveCache.get(pool);
  if (hit && Date.now() - hit.at < LIVE_TTL_MS) return hit.live;
  let p = liveInflight.get(pool);
  if (!p) {
    p = withTimeout(client().client.getPerpState(pool as `0x${string}`), LIVE_TIMEOUT_MS)
      .then((raw) => {
        const s = parseLiveState(raw as never);
        if (!s) return null;
        const live: Live = { markPrice: s.markPrice, indexPrice: s.indexPrice, markOk: s.markOk, readAt: Date.now() };
        liveCache.set(pool, { at: Date.now(), live });
        return live;
      })
      .catch(() => null)
      .finally(() => {
        liveInflight.delete(pool);
      });
    liveInflight.set(pool, p);
  }
  return p;
}

function merge(s: StaticRow, live: Live | null): MarketRow {
  if (live) return { ...s, markPrice: live.markPrice, indexPrice: live.indexPrice, markOk: live.markOk, readAt: live.readAt };
  // The live read failed: keep the snapshot number only so the shape is valid, and flag it not ok.
  return { ...s, indexPrice: "0", markOk: false, readAt: Date.now() };
}

/** Every market with its live mark, read in parallel. A market whose live read fails is flagged markOk=false. */
export async function getMarkets(): Promise<MarketRow[]> {
  const rows = await getStatic();
  const lives = await Promise.all(rows.map((r) => getLive(r.pool)));
  return rows.map((r, i) => merge(r, lives[i]));
}

/** One market with its live mark, or null when the pool is unknown. */
export async function getMarket(pool: string): Promise<MarketRow | null> {
  const rows = await getStatic();
  const s = rows.find((r) => r.pool.toLowerCase() === pool.toLowerCase());
  if (!s) return null;
  return merge(s, await getLive(s.pool));
}
