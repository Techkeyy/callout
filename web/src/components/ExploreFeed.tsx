"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useMarkets } from "@/lib/useMarkets";
import { loadOpenCalls, FEED_SCAN, type OpenCall, type OpenCallsResult } from "@/lib/feed";
import { displayDecimals, formatDisplay } from "@/lib/prices";
import { formatCountdown, shortAddress } from "@/lib/time";
import { recordLine } from "@/lib/outcome";
import { NOT_CONNECTED_COPY, UNREACHABLE_COPY } from "@/lib/readstate";
import NextStep from "./NextStep";
import { useWallet } from "@/lib/wallet";

const usd = (v: bigint) => formatDisplay(v, v % 10n ** 18n === 0n ? 0 : 2);

function Card({ o, name, dp, nowSec }: { o: OpenCall; name: string; dp: number; nowSec: number }) {
  const c = o.call;
  const left = Math.max(0, Number(c.expiresAt) - nowSec);
  return (
    <li>
      <Link href={"/c/" + o.id} className="xcard" aria-label={(c.isLong ? "Long " : "Short ") + name + ", call " + o.id}>
        <div className="xcard-top">
          <span className="xcard-market">{name}</span>
          <span className={"dir-chip " + (c.isLong ? "is-long" : "is-short")} style={{ margin: 0 }}>
            {c.isLong ? "Long" : "Short"}
          </span>
          <span className="xcard-left num">{formatCountdown(left)} left</span>
        </div>
        <div className="prices num" style={{ paddingTop: "var(--s-3)" }}>
          <div>
            <p className="price-k">Entry</p>
            <p className="price-v">{formatDisplay(c.entry, dp)}</p>
          </div>
          <div>
            <p className="price-k">Stop</p>
            <p className="price-v is-short">{formatDisplay(c.stop, dp)}</p>
          </div>
          <div>
            <p className="price-k">Target</p>
            <p className="price-v is-long">{formatDisplay(c.target, dp)}</p>
          </div>
        </div>
        <p className="xcard-meta num">
          {o.bond !== null ? "Bond " + usd(o.bond) + " USDso" : "Bond unknown"}
          {" · "}
          {o.remaining !== null ? usd(o.remaining) + " of " + usd(c.capacity) + " USDso open" : usd(c.capacity) + " USDso capacity"}
        </p>
        <p className="xcard-meta">
          <span className="num">{shortAddress(c.caller)}</span> · {recordLine(o.record)}
        </p>
      </Link>
    </li>
  );
}

/** Open calls anyone can take, soonest expiry first. Read in the browser from the newest calls. */
export default function ExploreFeed({ active }: { active: boolean }) {
  const w = useWallet();
  const { markets } = useMarkets(60_000);
  const [res, setRes] = useState<OpenCallsResult | null>(null);
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    setRes(null);
    loadOpenCalls(Math.floor(Date.now() / 1000)).then((r) => alive && setRes(r));
    return () => {
      alive = false;
    };
  }, [attempt]);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, [active]);

  const meta = (pool: string) => {
    const m = markets?.find((x) => x.pool.toLowerCase() === pool.toLowerCase());
    return { name: m?.name ?? "Market", dp: m ? displayDecimals(m.tickSize) : 2 };
  };
  const retry = () => setAttempt((n) => n + 1);

  return (
    <div className="wrap">
      <section className="hero">
        <h1>Open calls</h1>
        <p>Calls you can take right now. Each one has a bond behind it, and your stop and target are set for you. Soonest expiry first.</p>
      </section>
      {!w.address && <NextStep>Connect your wallet to take a call.</NextStep>}
      <div style={{ height: 16 }} />
      {res === null ? (
        <ul className="xgrid" aria-label="Loading open calls">
          {[0, 1, 2].map((i) => (
            <li key={i} className="skeleton" style={{ height: 170, borderRadius: "var(--r-md)" }} />
          ))}
        </ul>
      ) : res.status === "unavailable" ? (
        <div className="empty">
          <h2>Calls are not live yet.</h2>
          <p>{NOT_CONNECTED_COPY}</p>
        </div>
      ) : res.status === "error" ? (
        <div className="empty">
          <h2>Could not reach Somnia right now.</h2>
          <p>{UNREACHABLE_COPY}</p>
          <button className="btn btn-primary" onClick={retry}>
            Try again
          </button>
        </div>
      ) : res.rows.length === 0 ? (
        <div className="empty">
          <h2>No open calls right now.</h2>
          <p>{res.partial ? "Some calls could not be read, so this may be incomplete. Try again in a moment, or post one yourself." : "Nobody has an open call. Post one and be the first."}</p>
          <div className="actions">
            <Link className="btn btn-primary" href="/app">
              Post a call
            </Link>
            {res.partial && (
              <button className="btn" onClick={retry}>
                Try again
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          {res.partial && (
            <p className="notice is-warn" role="status" style={{ marginBottom: 12 }}>
              Some calls could not be read, so this list may be incomplete.{" "}
              <button className="linklike" onClick={retry}>
                Try again
              </button>
            </p>
          )}
          <ul className="xgrid">
            {res.rows.map((o) => {
              const m = meta(o.call.pool);
              return <Card key={o.id.toString()} o={o} name={m.name} dp={m.dp} nowSec={nowSec} />;
            })}
          </ul>
          <p className="hint" style={{ margin: "var(--s-4) 0 var(--s-16)" }}>
            Showing open calls among the newest {FEED_SCAN}.
          </p>
        </>
      )}
    </div>
  );
}
