import { getCandlesFor } from "@/lib/markets";

export const dynamic = "force-dynamic";

const INTERVALS = new Set([60, 300, 3600]);

/** GET /api/candles?pool=0x...&interval=60|300|3600&limit=200 returns raw candles, oldest first. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const pool = q.get("pool") ?? "";
  const interval = Number(q.get("interval") ?? "300");
  const limit = Math.min(500, Math.max(10, Number(q.get("limit") ?? "200") || 200));
  if (!/^0x[0-9a-fA-F]{40}$/.test(pool) || !INTERVALS.has(interval)) {
    return Response.json({ error: "Bad request." }, { status: 400 });
  }
  try {
    const candles = await getCandlesFor(pool, interval, limit);
    return Response.json({ candles }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Candles are not available right now." }, { status: 503 });
  }
}
