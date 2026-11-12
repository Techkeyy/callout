import { parseCallId } from "@/lib/calls";
import { loadCallModel } from "@/lib/cardload";
import { renderCard } from "@/lib/ogcard";

export const alt = "Callout trade call";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-dynamic";

/** The call card while open; the result card (HIT, STOPPED, EXPIRED) once the call is resolved. */
export default async function OgImage({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const id = parseCallId(raw);
  let model = null;
  try {
    model = id ? await loadCallModel(id) : null;
  } catch {
    model = null;
  }
  return renderCard(model);
}
