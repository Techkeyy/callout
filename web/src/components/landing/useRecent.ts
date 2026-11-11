"use client";
import { useEffect, useState } from "react";
import { loadRecentCalls, type RecentCall } from "@/lib/feed";
import { displayDecimals } from "@/lib/prices";
import { parseMarketRow } from "@/lib/useMarkets";

export interface RecentItem extends RecentCall {
  name: string;
  dp: number;
}
export type RecentState = { state: "loading" } | { state: "failed" } | { state: "unavailable" } | { state: "empty" } | { state: "ok"; items: RecentItem[] };

const TTL = 30_000;
let cached: { at: number; p: Promise<RecentState> } | null = null;

async function marketNames(pools: string[]): Promise<Map<string, { name: string; dp: number }>> {
  const out = new Map<string, { name: string; dp: number }>();
  await Promise.all(
    pools.map(async (pool) => {
      try {
        const r = await fetch("/api/markets?pool=" + encodeURIComponent(pool), { cache: "no-store" });
        const j = (await r.json()) as { markets: Array<Record<string, unknown>> };
        const m = j.markets.map(parseMarketRow).find((x) => x !== null);
        if (m) out.set(pool.toLowerCase(), { name: m.name, dp: displayDecimals(m.tickSize) });
      } catch {
        /* the name falls back below */
      }
    }),
  );
  return out;
}

async function load(): Promise<RecentState> {
  const r = await loadRecentCalls(8);
  if (r.status === "unavailable") return { state: "unavailable" };
  if (r.status === "error") return { state: "failed" };
  if (r.rows.length === 0) return { state: "empty" };
  const names = await marketNames([...new Set(r.rows.map((x) => x.call.pool.toLowerCase()))]);
  return {
    state: "ok",
    items: r.rows.map((x) => {
      const m = names.get(x.call.pool.toLowerCase());
      return { ...x, name: m?.name ?? "PERP", dp: m?.dp ?? 2 };
    }),
  };
}

/** Recent calls from the chain, read once in the browser and shared by everything on the landing page. */
export function useRecent(): { data: RecentState; retry: () => void } {
  const [data, setData] = useState<RecentState>({ state: "loading" });
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    if (!cached || Date.now() - cached.at > TTL || n > 0) cached = { at: Date.now(), p: load().catch((): RecentState => ({ state: "failed" })) };
    setData({ state: "loading" });
    cached.p.then((d) => {
      if (!alive) return;
      setData(d);
      if (d.state === "failed" || d.state === "unavailable") cached = null;
    });
    return () => {
      alive = false;
    };
  }, [n]);
  return { data, retry: () => setN((x) => x + 1) };
}
