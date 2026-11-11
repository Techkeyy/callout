"use client";
import { useEffect, useState } from "react";
import { useWallet } from "@/lib/wallet";
import { useMarkets } from "@/lib/useMarkets";
import { callBookAbi, describeError, getCallBookAddress } from "@/lib/callbook";
import { publicClient, readTakes } from "@/lib/calls";
import TakePanel from "./TakePanel";
import { txUrl } from "@/lib/chain";
import { callStatus } from "@/lib/time";
import { displayDecimals, displayName, formatDisplay, ladderDistances, toNumber } from "@/lib/prices";
import Ticket from "./Ticket";
import Ladder from "./Ladder";

interface Props {
  id: string;
  caller: string;
  pool: string;
  isLong: boolean;
  expiresAt: string;
  closedAt: string;
  entry: string;
  stop: string;
  target: string;
  note: string;
  serverNow: number;
  initialMarket: { name: string; tickSize: string; markPrice: string } | null;
  takes: { takers: number; fills: number; fees: string } | null;
}

export default function CallLive(p: Props) {
  const w = useWallet();
  const { markets, stale } = useMarkets();
  const [now, setNow] = useState(p.serverNow);
  const [closedAt, setClosedAt] = useState(BigInt(p.closedAt));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [closeTx, setCloseTx] = useState<string | null>(null);
  const [takes, setTakes] = useState(p.takes);
  // Somnia records a take a moment after the fill, so poll the ledger for a short while.
  async function refreshTakes() {
    const start = takes?.fills ?? 0;
    for (let n = 0; n < 12; n++) {
      const t = await readTakes(BigInt(p.id));
      if (t) {
        setTakes({ takers: t.takers, fills: t.fills, fees: t.fees.toString() });
        if (t.fills !== start) return;
      }
      await new Promise((r) => setTimeout(r, 2500));
    }
  }
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const entry = BigInt(p.entry);
  const stop = BigInt(p.stop);
  const target = BigInt(p.target);
  const live = markets?.find((m) => m.pool.toLowerCase() === p.pool.toLowerCase()) ?? null;
  const market = live ?? (p.initialMarket ? { name: p.initialMarket.name, tickSize: BigInt(p.initialMarket.tickSize), markPrice: BigInt(p.initialMarket.markPrice) } : null);
  const name = market?.name ?? displayName("PERP");
  const dp = market ? displayDecimals(market.tickSize) : 2;
  const mark = market ? toNumber(market.markPrice) : null;
  const status = callStatus({ expiresAt: BigInt(p.expiresAt), closedAt }, now);
  const secsLeft = Math.max(0, Number(p.expiresAt) - now);
  const dist = mark !== null ? ladderDistances(p.isLong, mark, toNumber(stop), toNumber(target)) : null;
  const isMine = !!w.address && w.address.toLowerCase() === p.caller.toLowerCase();

  async function close() {
    const addr = getCallBookAddress();
    const wc = w.client();
    if (!addr || !wc || !w.address) return;
    setErr(null);
    setBusy(true);
    try {
      if (w.wrongChain) await w.switchChain();
      const hash = await wc.writeContract({ address: addr, abi: callBookAbi, functionName: "close", args: [BigInt(p.id)], account: w.address, chain: wc.chain });
      const rc = await publicClient.waitForTransactionReceipt({ hash });
      if (rc.status !== "success") throw new Error("reverted");
      setClosedAt(BigInt(Math.floor(Date.now() / 1000)));
      setCloseTx(hash);
    } catch (e) {
      const d = describeError(e);
      if (d.kind === "error") setErr(d.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="call-grid">
      <div className="stack">
        <Ticket id={BigInt(p.id)} market={name} isLong={p.isLong} entry={entry} stop={stop} target={target} dp={dp} note={p.note} caller={p.caller} status={status} secsLeft={secsLeft} />
        <TakePanel
          callId={p.id}
          caller={p.caller as `0x${string}`}
          isLong={p.isLong}
          entry={entry}
          stop={stop}
          target={target}
          status={status}
          market={live}
          onChanged={refreshTakes}
        />
        <div className="panel">
          <h2>Takes</h2>
          {takes === null ? (
            <p className="hint">Take counts are not available right now.</p>
          ) : (
            <dl className="dist" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", marginTop: 0, borderTop: 0, paddingTop: 0 }}>
              <div>
                <dt className="dist-k">Takers</dt>
                <dd className="dist-v num" style={{ margin: 0 }}>{takes.takers}</dd>
              </div>
              <div>
                <dt className="dist-k">Fills</dt>
                <dd className="dist-v num" style={{ margin: 0 }}>{takes.fills}</dd>
              </div>
              <div>
                <dt className="dist-k">Fees earned</dt>
                <dd className="dist-v num" style={{ margin: 0 }}>{formatDisplay(BigInt(takes.fees), 4)} USDso</dd>
              </div>
            </dl>
          )}
          <p className="hint" style={{ marginTop: 8 }}>Takes are recorded on chain by Somnia, so nobody can add or remove one.</p>
        </div>
        {isMine && status === "open" && (
          <div className="panel">
            <h2>Close this call</h2>
            <p className="hint">Closing stops new takes. It does not change the record of what you posted.</p>
            {err && (
              <p className="notice is-warn" role="alert">
                {err}
              </p>
            )}
            <div className="actions" style={{ marginTop: 12 }}>
              <button className="btn" onClick={close} disabled={busy}>
                {busy ? "Closing..." : "Close call"}
              </button>
            </div>
          </div>
        )}
        {closeTx && (
          <p className="notice is-ok">
            Call closed.{" "}
            <a href={txUrl(closeTx)} target="_blank" rel="noopener noreferrer">
              View transaction
            </a>
          </p>
        )}
      </div>
      <div className="ladder-card">
        <p className="ladder-title">
          <span>{p.isLong ? "Long" : "Short"} ladder</span>
          <span className="num">
            <span className={`live-dot ${stale || !live ? "is-stale" : ""}`} />
            {market ? formatDisplay(market.markPrice, dp) : "no live price"}
          </span>
        </p>
        <Ladder isLong={p.isLong} entry={toNumber(entry)} stop={toNumber(stop)} target={toNumber(target)} mark={mark} dp={dp} />
        {dist && (
          <div className="dist">
            <div>
              <p className="dist-k">To target</p>
              <p className="dist-v num">{dist.targetReached ? "Reached" : `${dist.toTarget.toFixed(2)}% away`}</p>
            </div>
            <div>
              <p className="dist-k">To stop</p>
              <p className="dist-v num">{dist.stopReached ? "Hit" : `${dist.toStop.toFixed(2)}% away`}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
