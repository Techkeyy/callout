"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { decodeEventLog } from "viem";
import { useWallet } from "@/lib/wallet";
import { useMarkets } from "@/lib/useMarkets";
import { callBookAbi, describeError, getCallBookAddress, NOTE_MAX } from "@/lib/callbook";
import { publicClient } from "@/lib/calls";
import { txUrl } from "@/lib/chain";
import { alignToTick, displayDecimals, formatDisplay, formatPrice, parsePrice, roundToTick, toNumber, validatePrices } from "@/lib/prices";
import Ticket from "./Ticket";
import Ladder from "./Ladder";

const EXPIRIES = [
  { label: "1 hour", secs: 3600 },
  { label: "4 hours", secs: 4 * 3600 },
  { label: "24 hours", secs: 86400 },
  { label: "7 days", secs: 7 * 86400 },
];

type Posted = { id: bigint | null; hash: `0x${string}` };

export default function Composer() {
  const w = useWallet();
  const { markets, stale, failed } = useMarkets();
  const [poolSel, setPoolSel] = useState<string>("");
  const [isLong, setIsLong] = useState(true);
  const [entryS, setEntryS] = useState("");
  const [stopS, setStopS] = useState("");
  const [targetS, setTargetS] = useState("");
  const [expiry, setExpiry] = useState(86400);
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState<null | "wallet" | "chain">(null);
  const [err, setErr] = useState<string | null>(null);
  const [posted, setPosted] = useState<Posted | null>(null);

  const market = useMemo(
    () => markets?.find((m) => m.pool === poolSel) ?? markets?.find((m) => m.symbol.startsWith("BTC/")) ?? markets?.[0] ?? null,
    [markets, poolSel],
  );
  const tick = market?.tickSize ?? 0n;
  const dp = market ? displayDecimals(tick) : 2;
  const mark = market?.markPrice ?? null;

  const entry = parsePrice(entryS);
  const stop = parsePrice(stopS);
  const target = parsePrice(targetS);
  const v = validatePrices({ isLong, entry, stop, target });
  const offTick = [entry, stop, target].some((p) => p !== null && tick > 0n && p % tick !== 0n);
  const problems = [...v.problems];
  if (offTick) problems.push(`Prices must move in steps of ${formatPrice(tick)}. Use "Snap to market steps".`);
  const noteBytes = new TextEncoder().encode(note).length;
  const noteTooLong = noteBytes > NOTE_MAX;
  if (noteTooLong) problems.push("Your note is too long. Keep it to 280 characters.");
  const contract = getCallBookAddress();

  function snap() {
    if (!tick) return;
    const s = (t: string) => {
      const p = parsePrice(t);
      return p === null ? t : formatPrice(roundToTick(p, tick));
    };
    setEntryS(s(entryS));
    setStopS(s(stopS));
    setTargetS(s(targetS));
  }
  function useMark() {
    if (mark !== null) setEntryS(formatPrice(alignToTick(mark, tick)));
  }

  const valid = v.ok && !offTick && !noteTooLong && !!market;

  async function post() {
    setTouched(true);
    setErr(null);
    if (!valid || !market || entry === null || stop === null || target === null) return;
    if (!contract) {
      setErr("Posting is not switched on yet. The CallBook contract address is not set.");
      return;
    }
    const wc = w.client();
    if (!wc || !w.address) return;
    try {
      if (w.wrongChain) await w.switchChain();
      setBusy("wallet");
      const args = [market.pool as `0x${string}`, isLong, entry, stop, target, BigInt(Math.floor(Date.now() / 1000) + expiry), note.trim()] as const;
      // Somnia storage is expensive: use the node estimate and pad it 2x. Never a fixed low limit.
      const est = await publicClient.estimateContractGas({ address: contract, abi: callBookAbi, functionName: "post", args, account: w.address });
      const hash = await wc.writeContract({
        address: contract,
        abi: callBookAbi,
        functionName: "post",
        args,
        gas: est * 2n,
        account: w.address,
        chain: wc.chain,
      });
      setBusy("chain");
      const rc = await publicClient.waitForTransactionReceipt({ hash });
      if (rc.status !== "success") throw new Error("reverted");
      let id: bigint | null = null;
      for (const log of rc.logs) {
        try {
          const ev = decodeEventLog({ abi: callBookAbi, data: log.data, topics: log.topics });
          if (ev.eventName === "CallPosted") id = ev.args.id;
        } catch {
          /* not ours */
        }
      }
      setPosted({ id, hash });
    } catch (e) {
      const d = describeError(e);
      if (d.kind === "error") setErr(d.message);
    } finally {
      setBusy(null);
    }
  }

  if (posted) {
    const link = posted.id !== null ? `/c/${posted.id}` : null;
    return (
      <div className="wrap">
        <div className="empty">
          <h1>Your call is on the record.</h1>
          <p>It is written on chain and cannot be edited. Share the link and anyone can see it.</p>
          <div className="actions">
            {link && (
              <Link className="btn btn-primary" href={link}>
                Open your call
              </Link>
            )}
            <a className="btn" href={txUrl(posted.hash)} target="_blank" rel="noopener noreferrer">
              View transaction
            </a>
          </div>
          <button
            className="linklike"
            onClick={() => {
              setPosted(null);
              setEntryS("");
              setStopS("");
              setTargetS("");
              setNote("");
              setTouched(false);
            }}
          >
            Write another call
          </button>
        </div>
      </div>
    );
  }

  const nEntry = entry !== null ? toNumber(entry) : null;
  const nStop = stop !== null ? toNumber(stop) : null;
  const nTarget = target !== null ? toNumber(target) : null;
  const showLadder = nEntry !== null && nStop !== null && nTarget !== null && v.ok;

  let cta = "Post call";
  if (busy === "wallet") cta = "Confirm in your wallet...";
  if (busy === "chain") cta = "Writing to the chain...";

  const priceFields = [
    { lab: "Entry", val: entryS, set: setEntryS, bad: entry === null && touched },
    { lab: "Stop loss", val: stopS, set: setStopS, bad: stop === null && touched },
    { lab: "Take profit", val: targetS, set: setTargetS, bad: target === null && touched },
  ];

  return (
    <div className="wrap">
      <section className="hero">
        <h1>Post a call. Let anyone take it.</h1>
        <p>Write your trade once. It goes on the record where it cannot be edited, and followers can take it with your stop and target already set.</p>
      </section>
      <div className="desk">
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            post();
          }}
          noValidate
        >
          <div className="field">
            <label className="label" htmlFor="market">
              Market
            </label>
            {markets ? (
              <select id="market" className="select" value={market?.pool ?? ""} onChange={(e) => setPoolSel(e.target.value)}>
                {markets.map((m) => (
                  <option key={m.pool} value={m.pool}>
                    {m.name}
                  </option>
                ))}
              </select>
            ) : failed ? (
              <p className="notice is-warn" role="alert">
                Markets could not be loaded. Refresh the page to try again.
              </p>
            ) : (
              <div className="skeleton" style={{ height: 48 }} aria-label="Loading markets" />
            )}
            {mark !== null && (
              <p className="hint num">
                <span className={`live-dot ${stale ? "is-stale" : ""}`} />
                Live price {formatDisplay(mark, dp)}
                {stale ? " (last known)" : ""}
              </p>
            )}
          </div>

          <div className="field">
            <span className="label" id="dir-l">
              Direction
            </span>
            <div className="seg" role="group" aria-labelledby="dir-l">
              <button type="button" className="is-long" aria-pressed={isLong} onClick={() => setIsLong(true)}>
                Long
              </button>
              <button type="button" className="is-short" aria-pressed={!isLong} onClick={() => setIsLong(false)}>
                Short
              </button>
            </div>
          </div>

          <div className="row3">
            {priceFields.map((f) => (
              <div className="field" key={f.lab}>
                <label className="label" htmlFor={`p-${f.lab}`}>
                  {f.lab}
                </label>
                <input
                  id={`p-${f.lab}`}
                  className="input num"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0.00"
                  value={f.val}
                  aria-invalid={f.bad}
                  onChange={(e) => f.set(e.target.value)}
                />
              </div>
            ))}
          </div>
          <div className="field-head">
            <button type="button" className="linklike" onClick={useMark} disabled={mark === null}>
              Use live price as entry
            </button>
            <button type="button" className="linklike" onClick={snap} disabled={!tick}>
              Snap to market steps
            </button>
          </div>

          <div className="field">
            <span className="label" id="exp-l">
              Call stays open for
            </span>
            <div className="chips" role="group" aria-labelledby="exp-l">
              {EXPIRIES.map((x) => (
                <button type="button" key={x.secs} className="chip" aria-pressed={expiry === x.secs} onClick={() => setExpiry(x.secs)}>
                  {x.label}
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <div className="field-head">
              <label className="label" htmlFor="note">
                Your thesis (optional)
              </label>
              <span className="hint num">
                {noteBytes}/{NOTE_MAX}
              </span>
            </div>
            <textarea id="note" className="textarea" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why this trade, in a line or two." />
            <p className="hint">The note is part of the record and cannot be changed later.</p>
          </div>

          {touched && problems.length > 0 && (
            <ul className="problems" role="alert">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}
          {err && (
            <p className="notice is-warn" role="alert">
              {err}
            </p>
          )}
          {!contract && <p className="notice">Posting opens once the CallBook contract is live. You can still try out the composer.</p>}

          {!w.address ? (
            <button type="button" className="btn btn-primary btn-wide" onClick={() => w.connect()} disabled={w.connecting}>
              Connect wallet to post
            </button>
          ) : w.wrongChain ? (
            <button type="button" className="btn btn-primary btn-wide" onClick={w.switchChain}>
              Switch to Somnia Tokyo
            </button>
          ) : (
            <button type="submit" className="btn btn-primary btn-wide" disabled={busy !== null}>
              {cta}
            </button>
          )}
        </form>

        <aside className="desk-aside stack" aria-label="Preview">
          <Ticket preview market={market?.name ?? "Pick a market"} isLong={isLong} entry={entry} stop={stop} target={target} dp={dp} note={note} secsLeft={expiry} />
          {showLadder && (
            <div className="ladder-card">
              <p className="ladder-title">
                <span>Where your levels sit</span>
              </p>
              <Ladder isLong={isLong} entry={nEntry} stop={nStop} target={nTarget} mark={mark !== null ? toNumber(mark) : null} dp={dp} />
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
