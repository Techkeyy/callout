import type { SomniaMarkets } from "@somnia-chain/markets-sdk";
import { INDEXER_URL, WS_URL, somniaTokyo } from "./chain";
import { parseLiveState } from "./mark";
import { displayName } from "./prices";
import { hedge, withTimeout } from "./take";

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

let fx: Promise<SomniaMarkets> | null = null;
/** The SDK is imported on first use, so a page render that only needs metadata never pays for loading it. */
function client(): Promise<SomniaMarkets> {
  if (!fx) {
    fx = import("@somnia-chain/markets-sdk").then(
      (m) =>
        new m.SomniaMarkets({
          chain: somniaTokyo,
          indexerUrl: INDEXER_URL,
          wsRpcUrl: WS_URL,
          addresses: m.SOMNIA_HIDEKI_TESTNET_ADDRESSES,
        } as never),
    );
  }
  return fx;
}

// ---------- static metadata (cached for minutes) ----------

let staticCache: { at: number; rows: StaticRow[] } | null = null;
let staticInflight: Promise<StaticRow[]> | null = null;

async function loadStatic(): Promise<StaticRow[]> {
  const all = await (await client()).loadMarkets(true);
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

// ---------- one pool's metadata, from a single indexed read ----------

const metaCache = new Map<string, { at: number; row: StaticRow }>();
const metaInflight = new Map<string, Promise<StaticRow | null>>();

/** One pool's static metadata via getPerpMarket (one indexer read), cached for minutes, one in-flight load per pool. */
function loadMeta(pool: string): Promise<StaticRow | null> {
  const key = pool.toLowerCase();
  const hit = metaCache.get(key);
  if (hit && Date.now() - hit.at < STATIC_TTL_MS) return Promise.resolve(hit.row);
  let p = metaInflight.get(key);
  if (!p) {
    p = withTimeout(
      hedge(() => fetch(INDEXER_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: `{ Market(where:{poolAddress:{_eq:"${key}"}, marketType:{_eq:"PERP"}}) { poolAddress baseSymbol quoteSymbol tickSize lotSize minQuantity marginBank quoteToken stopRegistry baseDecimals markPrice } }`,
        }),
        cache: "no-store",
      }).then((r) => r.json()), [1500]),
      6000,
    )
      .then((j) => {
        const i = (j as { data?: { Market?: Array<Record<string, unknown>> } })?.data?.Market?.[0];
        if (!i || !/^\d+$/.test(String(i.tickSize)) || !/^\d+$/.test(String(i.minQuantity))) return null;
        const symbol = `${String(i.baseSymbol)}/${String(i.quoteSymbol)}:${String(i.quoteSymbol)}`;
        const row: StaticRow = {
          pool: String(i.poolAddress ?? pool),
          symbol,
          name: displayName(symbol),
          markPrice: String(i.markPrice ?? "0"),
          tickSize: String(i.tickSize),
          marginBank: String(i.marginBank),
          stopRegistry: String(i.stopRegistry),
          quoteToken: String(i.quoteToken),
          minQuantity: String(i.minQuantity),
          lotSize: String(i.lotSize),
          baseDecimals: Number(i.baseDecimals),
        };
        metaCache.set(key, { at: Date.now(), row });
        return row;
      })
      .catch(() => null)
      .finally(() => {
        metaInflight.delete(key);
      });
    metaInflight.set(key, p);
  }
  return p;
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
    p = withTimeout(client().then((c) => c.client.getPerpState(pool as `0x${string}`)), LIVE_TIMEOUT_MS)
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
  // Prefer the full list's cache when it is already warm, else one indexed read. Never wait on loadMarkets here.
  const cached = staticCache?.rows.find((r) => r.pool.toLowerCase() === pool.toLowerCase());
  const s = cached ?? (await loadMeta(pool));
  if (!s) return null;
  return merge(s, await getLive(s.pool));
}

// ---------- fast paths for page renders ----------
// A page must never wait on the 35-market list or on a cold loadMarkets. These race the long-lived caches against a short budget.

function raceNull<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p.catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

/** Static metadata (name, tick, ...) for one pool, or null if it is not ready within ms. The load keeps going in the background. */
export async function getMarketMeta(pool: string, ms = 2200): Promise<Omit<MarketRow, "indexPrice" | "markOk" | "readAt"> | null> {
  const cached = staticCache?.rows.find((r) => r.pool.toLowerCase() === pool.toLowerCase());
  return cached ?? (await raceNull(loadMeta(pool), ms));
}

/** One market with its live mark within ms in total, or null. Never blocks on anything else. */
export async function getMarketQuick(pool: string, ms = 2500): Promise<MarketRow | null> {
  const t0 = Date.now();
  const meta = await getMarketMeta(pool, Math.min(1500, ms));
  if (!meta) return null;
  const left = Math.max(300, ms - (Date.now() - t0));
  const live = await raceNull(getLive(meta.pool), left);
  return merge(meta, live);
}

/** Start the static load early so a cold function has it by the time a request needs it. */
export function warmMarkets(): void {
  getStatic().catch(() => {});
}

// ---------- candles (cached for seconds) ----------

const CANDLE_TTL_MS = 15_000;
const candleCache = new Map<string, { at: number; rows: Array<{ bucketStart: string; openPrice: string; high: string; low: string; closePrice: string }> }>();

/** Raw indexer candles for a pool, oldest first. Throws when the indexer cannot be read. An empty list means no trades. */
export async function getCandlesFor(pool: string, intervalSecs: number, limit = 200) {
  const key = `${pool.toLowerCase()}:${intervalSecs}:${limit}`;
  const hit = candleCache.get(key);
  if (hit && Date.now() - hit.at < CANDLE_TTL_MS) return hit.rows;
  const c = await client();
  const raw = await withTimeout(c.client.getCandles(pool as `0x${string}`, intervalSecs, { limit }), 8000);
  const rows = (raw as Array<{ bucketStart: string; openPrice: string; high: string; low: string; closePrice: string }>).map((r) => ({
    bucketStart: String(r.bucketStart),
    openPrice: String(r.openPrice),
    high: String(r.high),
    low: String(r.low),
    closePrice: String(r.closePrice),
  }));
  candleCache.set(key, { at: Date.now(), rows });
  return rows;
}
