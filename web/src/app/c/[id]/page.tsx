import type { Metadata } from "next";
import Link from "next/link";
import CallLive from "@/components/CallLive";
import { parseCallId, readCall, readTakes } from "@/lib/calls";
import { getMarkets } from "@/lib/markets";
import { NOT_CONNECTED_COPY } from "@/lib/readstate";
import { displayDecimals, displayName, formatDisplay } from "@/lib/prices";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { id: raw } = await params;
  const id = parseCallId(raw);
  const r = id ? await readCall(id) : null;
  if (!r || r.status !== "ok") return { title: "Call" };
  const c = r.call;
  const markets = await getMarkets().catch(() => []);
  const m = markets.find((x) => x.pool.toLowerCase() === c.pool.toLowerCase());
  const dp = m ? displayDecimals(BigInt(m.tickSize)) : 2;
  const title = `${c.isLong ? "Long" : "Short"} ${m?.name ?? displayName("PERP")} at ${formatDisplay(c.entry, dp)}`;
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
  const r = await readCall(id);
  if (r.status === "unavailable") return <Empty title="Calls are not live yet." body={`${NOT_CONNECTED_COPY} Check back soon.`} />;
  if (r.status === "missing") return <Empty title="This call does not exist." body="It may have a different number. Check the link and try again." />;
  if (r.status === "error") return <Empty title="Could not reach Somnia right now." body={r.message} refresh={`/c/${id}`} />;
  const c = r.call;
  const takes = await readTakes(id);
  const markets = await getMarkets().catch(() => []);
  const m = markets.find((x) => x.pool.toLowerCase() === c.pool.toLowerCase());
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
        serverNow={Math.floor(Date.now() / 1000)}
        initialMarket={m ? { name: m.name, tickSize: m.tickSize, markPrice: m.markPrice, markOk: m.markOk, readAt: m.readAt } : null}
        takes={takes ? { takers: takes.takers, fills: takes.fills, fees: takes.fees.toString() } : null}
      />
    </div>
  );
}
