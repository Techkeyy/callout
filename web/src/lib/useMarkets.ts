"use client";
import { useEffect, useState } from "react";

export interface ClientMarket {
  pool: `0x${string}`;
  symbol: string;
  name: string;
  /** Live on-chain mark when markOk. Never shown as live otherwise. */
  markPrice: bigint;
  indexPrice: bigint;
  /** False when the price feed is stale or could not be read. */
  markOk: boolean;
  /** Server time (ms) when the chain was read. */
  readAt: number;
  tickSize: bigint;
  marginBank: `0x${string}`;
  stopRegistry: `0x${string}`;
  quoteToken: `0x${string}`;
  minQuantity: bigint;
  lotSize: bigint;
  baseDecimals: number;
}

/** Turn one API row into a ClientMarket, or null when it is unusable. A missing markOk means not ok. */
export function parseMarketRow(m: Record<string, unknown>): ClientMarket | null {
  const ints = ["markPrice", "tickSize", "minQuantity", "lotSize"];
  if (!ints.every((k) => /^\d+$/.test(String(m[k])))) return null;
  return {
    pool: String(m.pool) as `0x${string}`,
    symbol: String(m.symbol),
    name: String(m.name),
    markPrice: BigInt(String(m.markPrice)),
    indexPrice: /^\d+$/.test(String(m.indexPrice)) ? BigInt(String(m.indexPrice)) : 0n,
    markOk: m.markOk === true,
    readAt: typeof m.readAt === "number" ? m.readAt : 0,
    tickSize: BigInt(String(m.tickSize)),
    marginBank: m.marginBank as `0x${string}`,
    stopRegistry: m.stopRegistry as `0x${string}`,
    quoteToken: m.quoteToken as `0x${string}`,
    minQuantity: BigInt(String(m.minQuantity)),
    lotSize: BigInt(String(m.lotSize)),
    baseDecimals: Number(m.baseDecimals),
  };
}

/**
 * Polls /api/markets, or one market's live state when `pool` is given (cheaper and fresher).
 * `stale` turns true when the last refresh failed.
 */
export function useMarkets(intervalMs = 6000, pool?: string) {
  const [markets, setMarkets] = useState<ClientMarket[] | null>(null);
  const [stale, setStale] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    const url = pool ? `/api/markets?pool=${encodeURIComponent(pool)}` : "/api/markets";
    const tick = async () => {
      try {
        const r = await fetch(url, { cache: "no-store" });
        if (!r.ok) throw new Error("bad");
        const j = (await r.json()) as { markets: Array<Record<string, unknown>> };
        if (!alive) return;
        setMarkets(j.markets.map(parseMarketRow).filter((m): m is ClientMarket => m !== null));
        setStale(false);
        setFailed(false);
      } catch {
        if (!alive) return;
        setStale(true);
        setFailed(true);
      }
    };
    tick();
    const t = setInterval(tick, intervalMs);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [intervalMs, pool]);
  return { markets, stale, failed };
}
