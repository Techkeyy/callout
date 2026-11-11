import Link from "next/link";
import { isAddress, getAddress } from "viem";
import { readCall, readCallsOf, readRecord, readResult, readTakes } from "@/lib/calls";
import RowClaim from "@/components/RowClaim";
import { hitRate, OUTCOME_LABEL, recordLine } from "@/lib/outcome";
import Earnings from "@/components/EarningsLazy";
import { NOT_CONNECTED_COPY, UNREACHABLE_COPY } from "@/lib/readstate";
import { getMarketMeta } from "@/lib/markets";
import { callStatus, shortAddress } from "@/lib/time";
import { displayDecimals, formatDisplay } from "@/lib/prices";

export const dynamic = "force-dynamic";

export default async function CallerPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!isAddress(address)) {
    return (
      <div className="wrap">
        <div className="empty">
          <h1>That is not a wallet address.</h1>
          <p>Check the link and try again.</p>
        </div>
      </div>
    );
  }
  const who = getAddress(address);
  const of = await readCallsOf(who);
  const ids = of.status === "ok" ? of.ids : null;
  const shown = ids ? ids.slice(0, 50) : [];
  const results = await Promise.all(shown.map((i) => readCall(i)));
  const takesList = await Promise.all((ids ?? []).map((i) => readTakes(i)));
  const [outcomes, record] = await Promise.all([Promise.all(shown.map((i) => readResult(i, { retries: 0, timeoutMs: 5000 }))), readRecord(who, { retries: 0, timeoutMs: 5000 })]);
  // Only the pools these calls use, from the long-lived metadata cache. Never the full live list.
  const pools = [...new Set(results.flatMap((r) => (r.status === "ok" ? [r.call.pool.toLowerCase()] : [])))];
  const metas = await Promise.all(pools.map((p) => getMarketMeta(p, 1500)));
  const markets = metas.filter((m) => m !== null);
  // A failed read must never look like zero. If any take or call read failed, say so instead of showing a low total.
  const partial = takesList.some((t) => t === null) || results.some((r) => r.status === "error");
  const total = takesList.reduce<{ fees: bigint; takers: number; fills: number }>((a, t) => ({ fees: a.fees + (t?.fees ?? 0n), takers: a.takers + (t?.takers ?? 0), fills: a.fills + (t?.fills ?? 0) }), { fees: 0n, takers: 0, fills: 0 });
  const now = Math.floor(Date.now() / 1000);
  return (
    <div className="wrap">
      <div className="page-head">
        <h1 className="num">{shortAddress(who)}</h1>
        <p className="hint">Every call this wallet has posted. They cannot be edited.</p>
      </div>
      {ids !== null && (
        <section className="panel" style={{ marginBottom: "var(--s-5)" }} aria-label="Record">
          <h2>Record</h2>
          {record === null ? (
            <p className="hint">The record is not available right now. Refresh in a moment.</p>
          ) : (
            <>
              <dl className="earn" style={{ marginTop: 12, marginBottom: 8 }}>
                <div>
                  <dt>Hit</dt>
                  <dd className="num">{record.hits}</dd>
                </div>
                <div>
                  <dt>Stopped</dt>
                  <dd className="num">{record.stops}</dd>
                </div>
                <div>
                  <dt>Expired</dt>
                  <dd className="num">{record.expired}</dd>
                </div>
                <div>
                  <dt>Hit rate</dt>
                  <dd className="num">{hitRate(record.hits, record.stops) === null ? "-" : `${Math.round(hitRate(record.hits, record.stops)!)}%`}</dd>
                </div>
              </dl>
              <p className="hint">{recordLine(record)}. Expired calls do not count toward the hit rate.</p>
            </>
          )}
        </section>
      )}
      {ids !== null && <Earnings address={who} earned={partial ? null : total.fees.toString()} takers={total.takers} fills={total.fills} />}
      {partial && ids !== null && (
        <p className="notice is-warn" role="status">
          {UNREACHABLE_COPY} <Link href={`/u/${who}`}>Refresh</Link>
        </p>
      )}
      {ids === null ? (
        of.status === "error" ? (
          <div className="empty">
            <h2>Could not reach Somnia right now.</h2>
            <p>Your calls are safe on chain. Refresh in a moment.</p>
            <Link className="btn btn-primary" href={`/u/${who}`}>
              Refresh
            </Link>
          </div>
        ) : (
          <div className="empty">
            <h2>Calls are not live yet.</h2>
            <p>{NOT_CONNECTED_COPY}</p>
          </div>
        )
      ) : ids.length === 0 ? (
        <div className="empty">
          <h2>No calls yet.</h2>
          <p>Calls this wallet posts will show up here.</p>
          <Link className="btn btn-primary" href="/">
            Write a call
          </Link>
        </div>
      ) : (
        <ul className="rows">
          {results.map((r, i) => {
            if (r.status !== "ok") return null;
            const c = r.call;
            const id = shown[i];
            const m = markets.find((x) => x.pool.toLowerCase() === c.pool.toLowerCase());
            const dp = m ? displayDecimals(BigInt(m.tickSize)) : 2;
            const st = callStatus(c, now);
            return (
              <li key={id.toString()}>
                <Link className="row-link" href={`/c/${id}`}>
                  <span className="row-id num">#{id.toString()}</span>
                  <span className="row-main">
                    <span className="row-title">
                      <span className={c.isLong ? "long" : "short"}>{c.isLong ? "Long" : "Short"}</span> {m?.name ?? "PERP"}
                    </span>
                    <span className="row-sub num">
                      Entry {formatDisplay(c.entry, dp)} / Stop {formatDisplay(c.stop, dp)} / Target {formatDisplay(c.target, dp)}
                    </span>
                    {outcomes[i] && outcomes[i]!.outcome !== "open" && <RowClaim id={id.toString()} />}
                  </span>
                  <span className="row-sub num">{takesList[i] ? `${takesList[i]!.takers} ${takesList[i]!.takers === 1 ? "taker" : "takers"}` : ""}</span>
                  {outcomes[i] && outcomes[i]!.outcome !== "open" ? (
                    <span className={`status is-out-${outcomes[i]!.outcome}`}>{OUTCOME_LABEL[outcomes[i]!.outcome]}</span>
                  ) : (
                    <span className={`status is-${st}`}>{st === "open" ? "Open" : st === "expired" ? "Expired" : "Closed"}</span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
