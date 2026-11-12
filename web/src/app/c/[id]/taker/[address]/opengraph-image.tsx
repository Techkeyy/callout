import { isAddress, getAddress } from "viem";
import { parseCallId } from "@/lib/calls";
import { loadTakerModel } from "@/lib/cardload";
import { renderCard } from "@/lib/ogcard";

export const alt = "A Callout take";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-dynamic";

export default async function OgImage({ params }: { params: Promise<{ id: string; address: string }> }) {
  const { id: raw, address } = await params;
  const id = parseCallId(raw);
  let model = null;
  try {
    model = id && isAddress(address) ? await loadTakerModel(id, getAddress(address)) : null;
  } catch {
    model = null;
  }
  return renderCard(model);
}
