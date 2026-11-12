import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { getAddress, isAddress } from "viem";
import ShareCard from "@/components/ShareCard";
import ShareLauncher from "@/components/ShareLauncher";
import { parseCallId } from "@/lib/calls";
import { loadTakerModel } from "@/lib/cardload";
import { shortAddress } from "@/lib/time";
import { parseTxHash } from "@/lib/trade";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; address: string }>; searchParams: Promise<{ close?: string | string[] }> };

const closeOf = (v: string | string[] | undefined) => parseTxHash(Array.isArray(v) ? v[0] : v);

const load = cache(async (id: bigint, who: `0x${string}`, close: string | null) => {
  try {
    return await loadTakerModel(id, who, close);
  } catch {
    return null;
  }
});

export async function generateMetadata({ params, searchParams }: Params): Promise<Metadata> {
  const { id: raw, address } = await params;
  const close = closeOf((await searchParams).close);
  const id = parseCallId(raw);
  const title = id && isAddress(address) ? `${shortAddress(getAddress(address))} took call #${id}` : "A Callout take";
  const description = "A call with a bond behind it. The result is on chain and cannot be edited.";
  // The default opengraph-image route cannot see the query string, so a close link names its own image route. That route
  // verifies the close on chain and falls back to the normal card for a hash it cannot confirm.
  const img = close && id && isAddress(address) ? [`/c/${id}/taker/${getAddress(address)}/image?close=${close}`] : undefined;
  return { title, description, openGraph: { title, description, ...(img ? { images: img } : {}) }, twitter: { card: "summary_large_image", title, description, ...(img ? { images: img } : {}) } };
}

export default async function TakerPage({ params, searchParams }: Params) {
  const { id: raw, address } = await params;
  const close = closeOf((await searchParams).close);
  const id = parseCallId(raw);
  if (!id || !isAddress(address)) {
    return (
      <div className="wrap">
        <div className="empty">
          <h1>That link is not a take.</h1>
          <p>Check the link and try again.</p>
        </div>
      </div>
    );
  }
  const model = await load(id, getAddress(address), close);
  if (!model) {
    return (
      <div className="wrap">
        <div className="empty">
          <h1>Could not load this card right now.</h1>
          <p>The call is safe on chain. Refresh in a moment.</p>
          <Link className="btn btn-primary" href={`/c/${id}`}>
            Open the call
          </Link>
        </div>
      </div>
    );
  }
  return (
    <div className="wrap">
      <h1 className="sr">{model.headline}</h1>
      <div className="share-card-page" style={{ marginTop: 24 }}>
        <ShareCard model={model} />
        <div className="actions" style={{ marginTop: 20 }}>
          <Link className="btn btn-primary" href={`/c/${id}`}>
            Open call #{id.toString()}
          </Link>
          <ShareLauncher label="Share this card" title="Share this card" model={model} />
        </div>
        <p className="hint" style={{ marginTop: 12 }}>
          {model.stamp === "CLOSED"
            ? "Entry, exit and realized P&L are read from this taker's close transaction on chain. Fees are charged on top."
            : "The call move is the price move of the call itself. The bond payout is what the caller's bond paid the takers. Neither is anyone's trade profit."}
        </p>
      </div>
    </div>
  );
}
