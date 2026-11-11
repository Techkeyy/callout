"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useMarkets } from "@/lib/useMarkets";
import { readTakenCalls, TAKES_SCAN, type TakenResult } from "@/lib/calls";
import { OUTCOME_LABEL } from "@/lib/outcome";
import { NOT_CONNECTED_COPY } from "@/lib/readstate";
import { formatDisplay } from "@/lib/prices";
import { ClaimButton } from "./ResolveClaim";

/** The calls this wallet took. It loads in the browser after the page, so the page itself stays fast. */
export default function Takes({ address }: { address: `0x${string}` }) {
  const { markets } = useMarkets(60_000);
  const [res, setRes] = useState<TakenResult | null>(null);

  const load = useCallback(() => {
    let alive = true;
    readTakenCalls(address).then((r) => alive && setRes(r));
    return () => {
      alive = false;
    };
  }, [address]);
  useEffect(() => load(), [load]);

  return (
    <section className="panel" style={{ marginBottom: "var(--s-8)" }} aria-label="Takes">
      <h2>Takes</h2>
      <p className="hint" style={{ marginBottom: 12 }}>Calls this wallet took, from the newest {TAKES_SCAN} calls.</p>
      {res === null ? (
        <div className="skeleton" style={{ height: 72 }} aria-label="Loading takes" />
      ) : res.status === "unavailable" ? (
        <p className="hint">{NOT_CONNECTED_COPY}</p>
      ) : res.status === "error" ? (
        <>
          <p className="notice is-warn" role="status">{res.message}</p>
          <button className="btn" style={{ marginTop: 12 }} onClick={() => { setRes(null); load(); }}>
            Try again
          </button>
        </>
      ) : (
        <>
          {res.partial && (
            <p className="notice is-warn" role="status">
              Some reads failed, so this list may be missing takes or claim amounts.{" "}
              <button className="linklike" onClick={() => { setRes(null); load(); }}>
                Try again
              </button>
            </p>
          )}
          {res.rows.length === 0 ? (
            <p className="hint">{res.partial ? "No takes found in what could be read." : "No takes found in the newest calls."}</p>
          ) : (
            <ul className="rows" style={{ paddingBottom: 0 }}>
              {res.rows.map((r) => {
                const m = markets?.find((x) => x.pool.toLowerCase() === r.pool.toLowerCase());
                return (
                  <li key={r.id.toString()}>
                    <div className="row-link">
                      <span className="row-id num">#{r.id.toString()}</span>
                      <span className="row-main">
                        <Link className="row-title" href={`/c/${r.id}`}>
                          <span className={r.isLong ? "long" : "short"}>{r.isLong ? "Long" : "Short"}</span> {m?.name ?? "PERP"}
                        </Link>
                        <span className="row-sub num">{formatDisplay(r.covered, 2)} USDso covered</span>
                        {r.claimable === null && <span className="row-sub">Claim amount not available right now.</span>}
                        {r.claimable !== null && r.claimable > 0n && <ClaimButton callId={r.id} amount={r.claimable} onDone={() => { setRes(null); load(); }} />}
                      </span>
                      <span className={r.outcome === "open" ? "status is-open" : `status is-out-${r.outcome}`}>{r.outcome === "open" ? "Open" : OUTCOME_LABEL[r.outcome]}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
