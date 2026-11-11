import { getMarket, getMarkets } from "@/lib/markets";

export const dynamic = "force-dynamic";

/** GET /api/markets returns every market. GET /api/markets?pool=0x... returns one market with its live mark. */
export async function GET(req: Request) {
  try {
    const pool = new URL(req.url).searchParams.get("pool");
    const markets = pool ? [await getMarket(pool)].filter((m) => m !== null) : await getMarkets();
    return Response.json({ markets }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Markets are not available right now." }, { status: 503 });
  }
}
