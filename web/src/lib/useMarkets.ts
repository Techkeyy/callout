"use client";
import { useEffect, useState } from "react";

export interface ClientMarket {
  pool: `0x${string}`;
  symbol: string;
  name: string;
  markPrice: bigint;
  tickSize: bigint;
  marginBank: `0x${string}`;
  stopRegistry: `0x${string}`;
  quoteToken: `0x${string}`;
  minQuantity: bigint;
  lotSize: bigint;
  baseDecimals: number;
}

/** Polls /api/markets. `stale` turns true when the last refresh failed. */
export function useMarkets(intervalMs = 6000) {
  const [markets, setMarkets] = useState<ClientMarket[] | null>(null);
  const [stale, setStale] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch("/api/markets", { cache: "no-store" });
        if (!r.ok) throw new Error("bad");
        const j = (await r.json()) as { markets: Array<Record<string, string | number>> };
        if (!alive) return;
        setMarkets(
          j.markets
            .filter((m) => /^\d+$/.test(String(m.markPrice)) && /^\d+$/.test(String(m.tickSize)) && /^\d+$/.test(String(m.minQuantity)))
            .map((m) => ({
              pool: String(m.pool) as `0x${string}`,
              symbol: String(m.symbol),
              name: String(m.name),
              markPrice: BigInt(m.markPrice),
              tickSize: BigInt(m.tickSize),
              marginBank: m.marginBank as `0x${string}`,
              stopRegistry: m.stopRegistry as `0x${string}`,
              quoteToken: m.quoteToken as `0x${string}`,
              minQuantity: BigInt(m.minQuantity),
              lotSize: BigInt(m.lotSize),
              baseDecimals: Number(m.baseDecimals),
            })),
        );
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
  }, [intervalMs]);
  return { markets, stale, failed };
}
