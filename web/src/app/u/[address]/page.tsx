import Link from "next/link";
import { isAddress, getAddress } from "viem";
import { readCall, readCallsOf } from "@/lib/calls";
import { getMarkets } from "@/lib/markets";
import { callStatus, shortAddress } from "@/lib/time";
import { displayDecimals, displayName, formatDisplay } from "@/lib/prices";

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
  const ids = await readCallsOf(who);
  const markets = await getMarkets().catch(() => []);
  const shown = ids ? ids.slice(0, 50) : [];
  const results = await Promise.all(shown.map((i) => readCall(i)));
  const now = Math.floor(Date.now() / 1000);
  return (
    <div className="wrap">
      <div className="page-head">
        <h1 className="num">{shortAddress(who)}</h1>
        <p className="hint">Every call this wallet has posted. They cannot be edited.</p>
      </div>
      {ids === null ? (
        <div className="empty">
          <h2>Calls are not live yet.</h2>
          <p>The CallBook contract has not been connected to this site yet.</p>
        </div>
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
                      <span className={c.isLong ? "long" : "short"}>{c.isLong ? "Long" : "Short"}</span> {m?.name ?? displayName("PERP")}
                    </span>
                    <span className="row-sub num">
                      Entry {formatDisplay(c.entry, dp)} / Stop {formatDisplay(c.stop, dp)} / Target {formatDisplay(c.target, dp)}
                    </span>
                  </span>
                  <span className={`status is-${st}`}>{st === "open" ? "Open" : st === "expired" ? "Expired" : "Closed"}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
