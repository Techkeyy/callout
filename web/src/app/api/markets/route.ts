import { getMarkets } from "@/lib/markets";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const markets = await getMarkets();
    return Response.json({ markets }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Markets are not available right now." }, { status: 503 });
  }
}
