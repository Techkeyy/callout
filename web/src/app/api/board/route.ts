import { loadBoard } from "@/lib/board";
import { rankBoard } from "@/lib/outcome";

export const dynamic = "force-dynamic";

/** GET /api/board?limit=3 returns the top callers by hit rate. Fees are 18-decimal strings. */
export async function GET(req: Request) {
  const limit = Math.min(20, Math.max(1, Number(new URL(req.url).searchParams.get("limit") ?? "3") || 3));
  try {
    const b = await loadBoard();
    if (!b.configured || b.unreachable) return Response.json({ error: "Not available." }, { status: 503 });
    const rows = rankBoard(b.rows)
      .slice(0, limit)
      .map((r) => ({ caller: r.caller, rate: r.rate, hits: r.hits, stops: r.stops, expiredLosses: r.expiredLosses, expired: r.expired, takers: r.takers, fees: r.fees.toString() }));
    return Response.json({ rows, partial: b.partial }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Not available." }, { status: 503 });
  }
}
