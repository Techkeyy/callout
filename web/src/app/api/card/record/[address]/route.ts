import { isAddress, getAddress } from "viem";
import { loadRecordModel } from "@/lib/cardload";

export const dynamic = "force-dynamic";

/** The record card model as JSON, for the share sheet on a profile page. */
export async function GET(_req: Request, { params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!isAddress(address)) return Response.json({ error: "bad address" }, { status: 400 });
  try {
    const model = await loadRecordModel(getAddress(address));
    if (!model) return Response.json({ error: "unavailable" }, { status: 503 });
    return Response.json(model, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
}
