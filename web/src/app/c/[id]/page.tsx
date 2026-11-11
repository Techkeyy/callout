import type { Metadata } from "next";
import Link from "next/link";
import CallLive from "@/components/CallLive";
import { parseCallId, readCall, readResult, readTakes } from "@/lib/calls";
import { cache } from "react";
import { getMarketMeta } from "@/lib/markets";
import { NOT_CONNECTED_COPY } from "@/lib/readstate";
import { displayDecimals, formatDisplay } from "@/lib/prices";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

// One read per request: generateMetadata and the page share the result.
const loadCall = cache((id: bigint) => readCall(id, { retries: 1, timeoutMs: 6000 }));
const loadTakes = cache((id: bigint) => readTakes(id, { retries: 0, timeoutMs: 4000 }));
const loadResult = cache((id: bigint) => readResult(id, { retries: 0, timeoutMs: 4000 }));
const loadMarket = cache((pool: string) => getMarketMeta(pool, 1000));

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id: raw } = await params;
  const id = parseCallId(raw);
  const r = id ? await loadCall(id) : null;
  if (!r || r.status !== "ok") return { title: "Call" };
  const c = r.call;
  const m = await loadMarket(c.pool);
  const dp = m ? displayDecimals(BigInt(m.tickSize)) : 2;
  const title = `${c.isLong ? "Long" : "Short"} ${m?.name ?? "call"} at ${formatDisplay(c.entry, dp)}`;
  const description = `Stop ${formatDisplay(c.stop, dp)}, target ${formatDisplay(c.target, dp)}. On the record, cannot be edited.`;
  return { title, description, openGraph: { title, description }, twitter: { card: "summary_large_image", title, description } };
}

function Empty({ title, body, refresh }: { title: string; body: string; refresh?: string }) {
  return (
    <div className="wrap">
      <div className="empty">
        <h1>{title}</h1>
        <p>{body}</p>
        {refresh ? (
          <Link className="btn btn-primary" href={refresh}>
            Refresh
          </Link>
        ) : (
          <Link className="btn btn-primary" href="/">
            Write a call
          </Link>
        )}
      </div>
    </div>
  );
}

export default async function CallPage({ params }: Params) {
  const { id: raw } = await params;
  const id = parseCallId(raw);
  if (!id) return <Empty title="That link is not a call." body="Check the link and try again." />;
  const [r, takes, result] = await Promise.all([loadCall(id), loadTakes(id), loadResult(id)]);
  if (r.status === "unavailable") return <Empty title="Calls are not live yet." body={`${NOT_CONNECTED_COPY} Check back soon.`} />;
  if (r.status === "missing") return <Empty title="This call does not exist." body="It may have a different number. Check the link and try again." />;
  if (r.status === "error") return <Empty title="Could not reach Somnia right now." body={r.message} refresh={`/c/${id}`} />;
  const c = r.call;
  // Only this pool, and only if it is ready fast. The card fetches the rest itself and keeps it live.
  const m = await loadMarket(c.pool);
  return (
    <div className="wrap">
      <h1 className="sr">Call #{id.toString()}</h1>
      <div style={{ height: 24 }} />
      <CallLive
        id={id.toString()}
        caller={c.caller}
        pool={c.pool}
        isLong={c.isLong}
        expiresAt={c.expiresAt.toString()}
        closedAt={c.closedAt.toString()}
        entry={c.entry.toString()}
        stop={c.stop.toString()}
        target={c.target.toString()}
        note={c.note}
        capacity={c.capacity.toString()}
        serverNow={Math.floor(Date.now() / 1000)}
        // Metadata only: the live price comes from the client poll, so a snapshot is never shown as live.
        initialMarket={m ? { name: m.name, tickSize: m.tickSize, markPrice: m.markPrice, markOk: false, readAt: 0 } : null}
        result={result ? { outcome: result.outcome, resolvedAt: result.resolvedAt.toString(), price: result.price.toString(), bond: result.bond.toString(), forfeit: result.forfeit.toString(), claimedTotal: result.claimedTotal.toString() } : null}
        takes={takes ? { takers: takes.takers, fills: takes.fills, fees: takes.fees.toString(), covered: takes.covered.toString() } : null}
      />
    </div>
  );
}
