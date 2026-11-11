"use client";
import { useCallback, useEffect, useState } from "react";
import { useWallet } from "@/lib/wallet";
import { useMarkets } from "@/lib/useMarkets";
import { ageLabel, markAgeSec, STALE_PRICE_COPY } from "@/lib/mark";
import { callBookAbi, describeError, getCallBookAddress } from "@/lib/callbook";
import { publicClient, readClaimable, readCovered, readRecord, readResult, readTakes } from "@/lib/calls";
import { deriveOutcome, recordLine, settlementLine, type Outcome, type RecordCounts } from "@/lib/outcome";
import { remainingCapacity } from "@/lib/rules";
import { ClaimPanel, ResolvePanel } from "./ResolveClaim";
import dynamic from "next/dynamic";

// The take panel pulls in the markets SDK. Loading it only in the browser keeps the server render fast and light.
const TakePanel = dynamic(() => import("./TakePanel"), {
  ssr: false,
  loading: () => (
    <div className="panel">
      <h2>Take this call</h2>
      <div className="skeleton" style={{ height: 52 }} aria-label="Loading" />
    </div>
  ),
});
import { txUrl } from "@/lib/chain";
import { callStatus } from "@/lib/time";
import { displayDecimals, formatDisplay, ladderDistances, toNumber } from "@/lib/prices";
import Ticket from "./Ticket";
import PriceChartLazy from "./PriceChartLazy";
import ShareButtons from "./ShareButtons";
import NextStep from "./NextStep";
import { useToast } from "./Toast";
import { callShareText, cardUrl, hitShareText, takeShareText } from "@/lib/share";
import Ladder from "./Ladder";

interface Props {
  id: string;
  caller: string;
  pool: string;
  isLong: boolean;
  postedAt: string;
  expiresAt: string;
  closedAt: string;
  entry: string;
  stop: string;
  target: string;
  note: string;
  /** Follower capacity, 18-decimal USDso. */
  capacity: string;
  serverNow: number;
  initialMarket: { name: string; tickSize: string; markPrice: string; markOk: boolean; readAt: number } | null;
  takes: { takers: number; fills: number; fees: string; covered: string } | null;
  result: { outcome: Outcome; resolvedAt: string; price: string; bond: string; forfeit: string; claimedTotal: string } | null;
}

export default function CallLive(p: Props) {
  const w = useWallet();
  const toast = useToast();
  const [justTook, setJustTook] = useState(false);
  const [origin, setOrigin] = useState(process.env.NEXT_PUBLIC_SITE_URL ?? "");
  useEffect(() => setOrigin(window.location.origin), []);
  const { markets, stale } = useMarkets(4000, p.pool);
  const [now, setNow] = useState(p.serverNow);
  const [closedAt, setClosedAt] = useState(BigInt(p.closedAt));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [closeTx, setCloseTx] = useState<string | null>(null);
  const [takes, setTakes] = useState(p.takes);
  const [result, setResult] = useState(p.result);
  const [record, setRecord] = useState<RecordCounts | null>(null);
  const [claimable, setClaimable] = useState<bigint | null>(null);
  const [myCovered, setMyCovered] = useState<bigint | null>(null);
  const outcome: Outcome = result?.outcome ?? "open";
  const resolved = outcome !== "open";

  async function refreshResult() {
    const [r, rec] = await Promise.all([readResult(BigInt(p.id)), readRecord(p.caller as `0x${string}`)]);
    if (r) setResult({ outcome: r.outcome, resolvedAt: r.resolvedAt.toString(), price: r.price.toString(), bond: r.bond.toString(), forfeit: r.forfeit.toString(), claimedTotal: r.claimedTotal.toString() });
    if (rec) setRecord(rec);
  }
  // The caller's record loads in the browser so the page itself stays fast.
  useEffect(() => {
    readRecord(p.caller as `0x${string}`).then((r) => r && setRecord(r));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.caller]);
  const refreshClaimable = useCallback(async () => {
    if (!w.address || !resolved) {
      setClaimable(null);
      return;
    }
    setClaimable(await readClaimable(BigInt(p.id), w.address));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w.address, resolved, p.id]);
  // Whether this wallet has a covered take: only then is a claim on a not yet recorded call worth offering.
  useEffect(() => {
    let alive = true;
    setMyCovered(null);
    if (w.address) readCovered(BigInt(p.id), w.address).then((c) => alive && setMyCovered(c));
    return () => {
      alive = false;
    };
  }, [w.address, p.id, takes?.fills]);
  useEffect(() => {
    refreshClaimable();
  }, [refreshClaimable]);
  // Somnia records a take a moment after the fill, so poll the ledger for a short while.
  async function refreshTakes() {
    const start = takes?.fills ?? 0;
    for (let n = 0; n < 12; n++) {
      const t = await readTakes(BigInt(p.id));
      if (t) {
        setTakes({ takers: t.takers, fills: t.fills, fees: t.fees.toString(), covered: t.covered.toString() });
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
  const market = live ?? (p.initialMarket ? { name: p.initialMarket.name, tickSize: BigInt(p.initialMarket.tickSize), markPrice: BigInt(p.initialMarket.markPrice), markOk: p.initialMarket.markOk, readAt: p.initialMarket.readAt } : null);
  // A stale or unread price is never shown as live.
  const priceOk = !!market && market.markOk;
  const name = market?.name ?? "Loading market";
  const dp = market ? displayDecimals(market.tickSize) : 2;
  const mark = market && priceOk ? toNumber(market.markPrice) : null;
  const status = callStatus({ expiresAt: BigInt(p.expiresAt), closedAt }, now);
  const secsLeft = Math.max(0, Number(p.expiresAt) - now);
  const dist = mark !== null ? ladderDistances(p.isLong, mark, toNumber(stop), toNumber(target)) : null;
  const isMine = !!w.address && w.address.toLowerCase() === p.caller.toLowerCase();
  const capacity = BigInt(p.capacity);
  const covered = takes ? BigInt(takes.covered) : null;
  const remaining = covered === null ? null : remainingCapacity(capacity, covered);
  // Same order as the contract: price first, then the clock. claim() settles such a call before it pays.
  const settleable = !resolved && deriveOutcome({ isLong: p.isLong, mark: live?.markPrice ?? null, markOk: !!live && live.markOk, stop, target, nowSec: now, expiresAtSec: Number(p.expiresAt) }) !== null;
  const canClaimEarly = settleable && (isMine || (myCovered !== null && myCovered > 0n));
  const settlement = result ? settlementLine({ outcome, priceText: formatDisplay(BigInt(result.price), dp), forfeit: BigInt(result.forfeit), bond: BigInt(result.bond), covered }) : null;

  const shareCall = { market: name, isLong: p.isLong, entry: formatDisplay(entry, dp), stop: formatDisplay(stop, dp), target: formatDisplay(target, dp), bond: result ? formatDisplay(BigInt(result.bond), BigInt(result.bond) % 10n ** 18n === 0n ? 0 : 2) : null };
  const url = origin ? cardUrl(origin, p.id) : "";
  const shareMode: "took" | "hit" | "call" = justTook ? "took" : outcome === "hit" && isMine ? "hit" : "call";
  const shareHead = shareMode === "took" ? "You took this call. Share it?" : shareMode === "hit" ? "Share your hit" : "Share this call";
  const shareBody = shareMode === "took" ? takeShareText(shareCall) : shareMode === "hit" ? hitShareText(shareCall) : callShareText(shareCall);
  const hasClaim = resolved && claimable !== null && claimable > 0n;
  const next = !w.address ? (
    <>Connect your wallet to post or take.</>
  ) : hasClaim ? (
    <>{isMine ? "Claim your bond." : "Claim your share of the bond."}</>
  ) : justTook ? (
    <>Your stop and target are armed. Watch it here.</>
  ) : shareMode === "hit" ? (
    <>Share your hit.</>
  ) : !resolved && status === "open" && !isMine ? (
    <>Take this call below. Your stop and target are set for you.</>
  ) : !resolved && status === "open" && isMine ? (
    <>Share your call so others can take it.</>
  ) : null;

  async function close() {
    const addr = getCallBookAddress();
    const wc = w.client();
    if (!addr || !wc || !w.address) return;
    setErr(null);
    setBusy(true);
    const tid = toast.show({ tone: "pending", text: "Confirm in your wallet." });
    try {
      if (w.wrongChain) await w.switchChain();
      toast.update(tid, { text: "Confirm in your wallet." });
      const hash = await wc.writeContract({ address: addr, abi: callBookAbi, functionName: "close", args: [BigInt(p.id)], account: w.address, chain: wc.chain });
      toast.update(tid, { text: "Submitted. Waiting for confirmation.", hash });
      const rc = await publicClient.waitForTransactionReceipt({ hash });
      if (rc.status !== "success") throw new Error("reverted");
      setClosedAt(BigInt(Math.floor(Date.now() / 1000)));
      setCloseTx(hash);
      toast.update(tid, { tone: "ok", text: "Call closed.", hash });
    } catch (e) {
      const d = describeError(e);
      if (d.kind === "error") {
        setErr(d.message);
        toast.update(tid, { tone: "warn", text: d.message });
      } else toast.dismiss(tid);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="call-grid">
      <div className="call-chart">
        <PriceChartLazy
          pool={p.pool}
          isLong={p.isLong}
          entry={toNumber(entry)}
          stop={toNumber(stop)}
          target={toNumber(target)}
          mark={mark}
          dp={dp}
          postedAt={Number(p.postedAt)}
          resolved={result && outcome !== "open" ? { outcome, price: toNumber(BigInt(result.price)), at: Number(result.resolvedAt) } : null}
        />
      </div>
      <div className="stack">
        {next && <NextStep tone={hasClaim ? "go" : "info"}>{next}</NextStep>}
        <Ticket id={BigInt(p.id)} market={name} isLong={p.isLong} entry={entry} stop={stop} target={target} dp={dp} note={p.note} caller={p.caller} status={status} secsLeft={secsLeft} outcome={outcome} bond={result ? BigInt(result.bond) : null} capacity={capacity} covered={covered} settlement={settlement} recordLine={recordLine(record)} />
        {!resolved && <ResolvePanel callId={BigInt(p.id)} isLong={p.isLong} stop={stop} target={target} expiresAt={Number(p.expiresAt)} nowSec={now} market={live} onDone={refreshResult} />}
        {(resolved || canClaimEarly) && <ClaimPanel callId={BigInt(p.id)} outcome={outcome} claimable={claimable} isCaller={isMine} settleable={canClaimEarly} onDone={() => { refreshResult(); refreshClaimable(); }} />}
        <TakePanel
          callId={p.id}
          caller={p.caller as `0x${string}`}
          isLong={p.isLong}
          entry={entry}
          stop={stop}
          target={target}
          status={resolved ? "resolved" : status}
          market={live}
          remaining={remaining}
          onChanged={refreshTakes}
          onTaken={() => setJustTook(true)}
        />
        <div className="panel">
          <h2>{shareHead}</h2>
          <p className="hint" style={{ marginBottom: 12 }}>{shareBody} {url}</p>
          {url ? <ShareButtons text={shareBody} url={url} primary={justTook || shareMode === "hit"} /> : <div className="skeleton" style={{ height: 44 }} aria-label="Loading" />}
        </div>
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
        {isMine && status === "open" && !resolved && (
          <div className="panel">
            <h2>Close this call</h2>
            <p className="hint">Closing stops new takes. The call can still be resolved until it expires, and your bond stays locked until the call settles.</p>
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
      <div className="stack">
      <div className="ladder-card">
        <p className="ladder-title">
          <span>{p.isLong ? "Long" : "Short"} ladder</span>
          <span className="num">
            <span className={`live-dot ${stale || !live || !priceOk ? "is-stale" : ""}`} />
            {market && priceOk ? formatDisplay(market.markPrice, dp) : "no live price"}
          </span>
        </p>
        <p className="hint" style={{ margin: "0 0 8px" }}>
          {!market || market.readAt === 0 ? "Waiting for the price." : !priceOk ? `${STALE_PRICE_COPY}.` : market.readAt > 0 ? ageLabel(markAgeSec(market.readAt, now * 1000)) : ""}
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
    </div>
  );
}
