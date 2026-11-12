import { isAddress, getAddress } from "viem";
import { loadRecordModel } from "@/lib/cardload";
import { renderCard } from "@/lib/ogcard";

export const alt = "A Callout record";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-dynamic";

export default async function OgImage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  let model = null;
  try {
    model = isAddress(address) ? await loadRecordModel(getAddress(address)) : null;
  } catch {
    model = null;
  }
  return renderCard(model);
}
