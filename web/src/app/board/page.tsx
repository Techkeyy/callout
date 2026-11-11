import Link from "next/link";
import type { Metadata } from "next";
import { loadBoard } from "@/lib/board";
import { rankBoard } from "@/lib/outcome";
import { formatDisplay } from "@/lib/prices";
import { shortAddress } from "@/lib/time";
import { NOT_CONNECTED_COPY, UNREACHABLE_COPY } from "@/lib/readstate";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Leaderboard", description: "Callers ranked by how often their calls hit the target before a stop or a losing expiry." };

export default async function BoardPage() {
  const board = await loadBoard();
  const ranked = rankBoard(board.rows);
  return (
    <div className="wrap">
      <div className="page-head">
        <h1>Leaderboard</h1>
        <p className="hint">
          Callers ranked by hit rate: calls that reached the target, out of those that hit the target, hit the stop, or expired with the price against the call. Expiring in profit does not count either way. A caller needs at least one resolved call.
        </p>
      </div>
      {!board.configured ? (
        <div className="empty">
          <h2>Calls are not live yet.</h2>
          <p>{NOT_CONNECTED_COPY}</p>
        </div>
      ) : board.unreachable ? (
        <div className="empty">
          <h2>Could not reach Somnia right now.</h2>
          <p>{UNREACHABLE_COPY}</p>
          <Link className="btn btn-primary" href="/board">
            Refresh
          </Link>
        </div>
      ) : (
        <>
          {board.partial && (
            <p className="notice is-warn" role="status">
              Some calls could not be read, so the takers and fees below may be low. <Link href="/board">Refresh</Link>
            </p>
          )}
          {ranked.length === 0 ? (
            <div className="empty">
              <h2>No resolved calls yet.</h2>
              <p>Once a call hits its target, stops out or expires, its caller appears here. Post a call, or take one.</p>
              <Link className="btn btn-primary" href="/">
                Write a call
              </Link>
            </div>
          ) : (
            <div className="board-wrap">
              <table className="board">
                <caption className="sr">Callers ranked by hit rate</caption>
                <thead>
                  <tr>
                    <th scope="col">#</th>
                    <th scope="col">Caller</th>
                    <th scope="col" className="n">Hit rate</th>
                    <th scope="col" className="n">Hit</th>
                    <th scope="col" className="n">Stopped</th>
                    <th scope="col" className="n">Expired losses</th>
                    <th scope="col" className="n">Expired in profit</th>
                    <th scope="col" className="n">Takers</th>
                    <th scope="col" className="n">Fees earned</th>
                  </tr>
                </thead>
                <tbody>
                  {ranked.map((r, i) => (
                    <tr key={r.caller}>
                      <td className="num">{i + 1}</td>
                      <td>
                        <Link className="num" href={`/u/${r.caller}`}>
                          {shortAddress(r.caller)}
                        </Link>
                      </td>
                      <td className="n num">{r.rate === null ? "-" : `${Math.round(r.rate)}%`}</td>
                      <td className="n num">{r.hits}</td>
                      <td className="n num">{r.stops}</td>
                      <td className="n num">{r.expiredLosses}</td>
                      <td className="n num">{r.expired - r.expiredLosses}</td>
                      <td className="n num">{r.takers}</td>
                      <td className="n num">{formatDisplay(r.fees, 4)} USDso</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="hint" style={{ marginBottom: "var(--s-16)" }}>
            Hits, stops and expiries come from each caller&apos;s on-chain record. A losing expiry counts as a miss, the same as a stop. Takers and fees count the newest {board.scanned} of {board.total} calls.
          </p>
        </>
      )}
    </div>
  );
}
