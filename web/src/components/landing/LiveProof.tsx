"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import Ticket from "../Ticket";
import { useRecent } from "./useRecent";
import { callStatus, shortAddress } from "@/lib/time";
import { hitRate } from "@/lib/outcome";

interface Row {
  caller: string;
  rate: number | null;
  hits: number;
  stops: number;
  expiredLosses: number;
  takers: number;
}
type BoardState = { state: "loading" } | { state: "failed" } | { state: "ok"; rows: Row[] };

/** Real tickets and the top of the leaderboard, read from the chain after the page has painted. */
export default function LiveProof() {
  const { data, retry } = useRecent();
  const [board, setBoard] = useState<BoardState>({ state: "loading" });
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    setBoard({ state: "loading" });
    fetch("/api/board?limit=3", { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error("bad");
        return r.json() as Promise<{ rows: Row[] }>;
      })
      .then((j) => alive && setBoard({ state: "ok", rows: j.rows }))
      .catch(() => alive && setBoard({ state: "failed" }));
    return () => {
      alive = false;
    };
  }, [n]);
  const now = Math.floor(Date.now() / 1000);

  return (
    <div className="lp">
      <div>
        <h3 className="lp-h">Latest calls</h3>
        {data.state === "loading" ? (
          <div className="lp-tickets">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton" style={{ height: 300, borderRadius: "var(--r-md)" }} aria-label="Loading" />
            ))}
          </div>
        ) : data.state === "failed" ? (
          <div className="lp-empty">
            <p>Could not read calls from the chain right now.</p>
            <button type="button" className="btn btn-small" onClick={retry}>
              Try again
            </button>
          </div>
        ) : data.state === "unavailable" ? (
          <div className="lp-empty">
            <p>Calls are not live yet.</p>
          </div>
        ) : data.state === "empty" ? (
          <div className="lp-empty">
            <p>No calls yet. Post the first one and it shows up here.</p>
            <Link className="btn btn-primary btn-small" href="/app">
              Post a call
            </Link>
          </div>
        ) : (
          <ul className="lp-tickets">
            {data.items.slice(0, 3).map((i) => {
              const secsLeft = Math.max(0, Number(i.call.expiresAt) - now);
              return (
                <li key={i.id.toString()}>
                  <Link href={"/c/" + i.id} className="lp-link" aria-label={"Open call " + i.id}>
                    <Ticket
                      id={i.id}
                      market={i.name}
                      isLong={i.call.isLong}
                      entry={i.call.entry}
                      stop={i.call.stop}
                      target={i.call.target}
                      dp={i.dp}
                      note={i.call.note}
                      caller={i.call.caller}
                      status={callStatus(i.call, now)}
                      secsLeft={secsLeft}
                      outcome={i.outcome}
                      bond={i.bond}
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="lp-board">
        <h3 className="lp-h">Top callers</h3>
        {board.state === "loading" ? (
          <div className="skeleton" style={{ height: 150, borderRadius: "var(--r-md)" }} aria-label="Loading" />
        ) : board.state === "failed" ? (
          <div className="lp-empty">
            <p>Could not read the leaderboard right now.</p>
            <button type="button" className="btn btn-small" onClick={() => setN((x) => x + 1)}>
              Try again
            </button>
          </div>
        ) : board.rows.length === 0 ? (
          <div className="lp-empty">
            <p>No resolved calls yet. The first outcome puts a caller on the board.</p>
          </div>
        ) : (
          <ol className="lp-rows">
            {board.rows.map((r, i) => {
              const rate = r.rate ?? hitRate(r.hits, r.stops, r.expiredLosses);
              return (
                <li key={r.caller}>
                  <Link href={"/u/" + r.caller} className="lp-row">
                    <span className="lp-rank num">{i + 1}</span>
                    <span className="num">{shortAddress(r.caller)}</span>
                    <span className="lp-rate num">{rate === null ? "-" : Math.round(rate) + "%"}</span>
                    <span className="lp-rec">
                      {r.hits} hit, {r.stops} stopped
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
        <Link className="linklike" href="/board" style={{ display: "inline-block", marginTop: 12 }}>
          See the full leaderboard
        </Link>
      </div>
    </div>
  );
}
