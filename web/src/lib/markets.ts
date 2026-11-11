import { SomniaMarkets, SOMNIA_HIDEKI_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { INDEXER_URL, WS_URL, somniaTokyo } from "./chain";
import { displayName } from "./prices";

/** One perp market. Price fields are 18-decimal raw integers as strings (the SDK already returns raw units). */
export interface MarketRow {
  pool: string;
  symbol: string;
  name: string;
  markPrice: string;
  tickSize: string;
}

const TTL_MS = 5000;
let cache: { at: number; rows: MarketRow[] } | null = null;
let inflight: Promise<MarketRow[]> | null = null;

async function fetchMarkets(): Promise<MarketRow[]> {
  const fx = new SomniaMarkets({
    chain: somniaTokyo,
    indexerUrl: INDEXER_URL,
    wsRpcUrl: WS_URL,
    addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES,
  } as never);
  const all = await fx.loadMarkets(true);
  const rows: MarketRow[] = [];
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
    });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}

/** Cached for a few seconds so a burst of viewers makes one SDK load. */
export async function getMarkets(): Promise<MarketRow[]> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rows;
  if (!inflight) {
    inflight = fetchMarkets()
      .then((rows) => {
        cache = { at: Date.now(), rows };
        return rows;
      })
      .finally(() => {
        inflight = null;
      });
  }
  try {
    return await inflight;
  } catch (e) {
    if (cache) return cache.rows; // stale beats nothing
    throw e;
  }
}
