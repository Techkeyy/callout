"use client";
import { useEffect, useState } from "react";

export interface ClientMarket {
  pool: string;
  symbol: string;
  name: string;
  markPrice: bigint;
  tickSize: bigint;
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
        const j = (await r.json()) as { markets: Array<{ pool: string; symbol: string; name: string; markPrice: string; tickSize: string }> };
        if (!alive) return;
        setMarkets(j.markets.filter((m) => /^\d+$/.test(m.markPrice) && /^\d+$/.test(m.tickSize)).map((m) => ({ ...m, markPrice: BigInt(m.markPrice), tickSize: BigInt(m.tickSize) })));
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
