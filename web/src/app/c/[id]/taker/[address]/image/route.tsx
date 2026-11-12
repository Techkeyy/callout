import { isAddress, getAddress } from "viem";
import { parseCallId } from "@/lib/calls";
import { loadTakerModel } from "@/lib/cardload";
import { renderCard } from "@/lib/ogcard";

export const dynamic = "force-dynamic";

/**
 * The taker card as a PNG, with the ?close=<tx> parameter available (the file-convention opengraph-image route does not
 * receive the query string). The closed card renders only when the chain confirms the close; otherwise the normal card.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string; address: string }> }) {
  const { id: raw, address } = await params;
  const id = parseCallId(raw);
  const close = new URL(req.url).searchParams.get("close");
  let model = null;
  try {
    model = id && isAddress(address) ? await loadTakerModel(id, getAddress(address), close) : null;
  } catch {
    model = null;
  }
  return renderCard(model);
}
