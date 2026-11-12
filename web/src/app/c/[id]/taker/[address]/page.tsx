import type { Metadata } from "next";
import Link from "next/link";
import { cache } from "react";
import { getAddress, isAddress } from "viem";
import ShareCard from "@/components/ShareCard";
import ShareLauncher from "@/components/ShareLauncher";
import { parseCallId } from "@/lib/calls";
import { loadTakerModel } from "@/lib/cardload";
import { shortAddress } from "@/lib/time";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; address: string }> };

const load = cache(async (id: bigint, who: `0x${string}`) => {
  try {
    return await loadTakerModel(id, who);
  } catch {
    return null;
  }
});

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id: raw, address } = await params;
  const id = parseCallId(raw);
  const title = id && isAddress(address) ? `${shortAddress(getAddress(address))} took call #${id}` : "A Callout take";
  const description = "A call with a bond behind it. The result is on chain and cannot be edited.";
  return { title, description, openGraph: { title, description }, twitter: { card: "summary_large_image", title, description } };
}

export default async function TakerPage({ params }: Params) {
  const { id: raw, address } = await params;
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
  const model = await load(id, getAddress(address));
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
        <p className="hint" style={{ marginTop: 12 }}>The call move is the price move of the call itself. The bond payout is what the caller&apos;s bond paid the takers. Neither is anyone&apos;s trade profit.</p>
      </div>
    </div>
  );
}
