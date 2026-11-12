"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { decodeEventLog } from "viem";
import { useWallet } from "@/lib/wallet";
import { useMarkets } from "@/lib/useMarkets";
import { ageLabel, markAgeSec, STALE_PRICE_COPY } from "@/lib/mark";
import { callBookAbi, DEFAULT_MIN_BOND, describeError, erc20Abi, getCallBookAddress, NOTE_MAX } from "@/lib/callbook";
import { DREAMDEX_APP_URL } from "@/lib/dex";
import { publicClient, readMinBond } from "@/lib/calls";
import { withRetry } from "@/lib/take";
import { txUrl } from "@/lib/chain";
import { alignToTick, displayDecimals, formatDisplay, formatPrice, parsePrice, roundToTick, toNumber, validatePrices } from "@/lib/prices";
import { defaultBond, minBondFor, validatePostRules } from "@/lib/rules";
import Ticket from "./Ticket";
import Ladder from "./Ladder";
import PriceChartLazy from "./PriceChartLazy";
import ShareSheet from "./ShareSheet";
import NextStep from "./NextStep";
import { useToast } from "./Toast";
import { callCardModel } from "@/lib/cardmodel";
import { chainTimeExact } from "@/lib/chainclock";

const EXPIRIES = [
  { label: "1 hour", secs: 3600 },
  { label: "4 hours", secs: 4 * 3600 },
  { label: "24 hours", secs: 86400 },
  { label: "7 days", secs: 7 * 86400 },
];

type Posted = {
  id: bigint | null;
  hash: `0x${string}`;
  snap: { market: string; isLong: boolean; entry: bigint; stop: bigint; target: bigint; dp: number; note: string; bond: bigint; capacity: bigint; secsLeft: number };
};

export default function Composer() {
  const w = useWallet();
  const toast = useToast();
  const [shareOpen, setShareOpen] = useState(false);
  const { markets, stale, failed } = useMarkets();
  const [nowMs, setNowMs] = useState(0);
  useEffect(() => {
    setNowMs(Date.now());
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const [poolSel, setPoolSel] = useState<string>("");
  const [isLong, setIsLong] = useState(true);
  const [entryS, setEntryS] = useState("");
  const [stopS, setStopS] = useState("");
  const [targetS, setTargetS] = useState("");
  const problemsRef = useRef<HTMLUListElement>(null);
  const [presetExpiry, setPresetExpiry] = useState(86400);
  // Custom duration: any length from 5 minutes to the contract's 30-day maximum.
  const [customOn, setCustomOn] = useState(false);
  const [customVal, setCustomVal] = useState("12");
  const [customUnit, setCustomUnit] = useState<"minutes" | "hours" | "days">("hours");
  const UNIT_SECS = { minutes: 60, hours: 3600, days: 86400 } as const;
  const customSecs = Math.round((Number(customVal) || 0) * UNIT_SECS[customUnit]);
  const expiry = customOn ? customSecs : presetExpiry;
  const setExpiry = (secs: number) => {
    setCustomOn(false);
    setPresetExpiry(secs);
  };
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState<null | "approve" | "wallet" | "chain">(null);
  const [capacityS, setCapacityS] = useState("100");
  const [bondS, setBondS] = useState("5");
  const [bondEdited, setBondEdited] = useState(false);
  const [minBond, setMinBond] = useState<bigint>(DEFAULT_MIN_BOND);
  const [bondToken, setBondToken] = useState<`0x${string}` | null>(null);
  const [usdso, setUsdso] = useState<{ balance: bigint; allowance: bigint } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [posted, setPosted] = useState<Posted | null>(null);

  const market = useMemo(
    () => markets?.find((m) => m.pool === poolSel) ?? markets?.find((m) => m.symbol.startsWith("BTC/")) ?? markets?.[0] ?? null,
    [markets, poolSel],
  );
  // The selected market is re-read on its own, faster, so its mark is the live on-chain value.
  const sel = useMarkets(4000, market?.pool);
  const liveSel = sel.markets?.[0] ?? null;
  const priceOk = !!liveSel && liveSel.markOk;
  const tick = market?.tickSize ?? 0n;
  const dp = market ? displayDecimals(tick) : 2;
  const mark = liveSel && liveSel.markOk ? liveSel.markPrice : null;

  const contractAddr = getCallBookAddress();
  useEffect(() => {
    if (!contractAddr) return;
    let alive = true;
    readMinBond().then((m) => alive && m !== null && setMinBond(m));
    publicClient
      .readContract({ address: contractAddr, abi: callBookAbi, functionName: "bondToken" })
      .then((t) => alive && setBondToken(t as `0x${string}`))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [contractAddr]);

  const readUsdso = useCallback(async () => {
    if (!contractAddr || !bondToken || !w.address) return;
    try {
      const [balance, allowance] = await Promise.all([
        publicClient.readContract({ address: bondToken, abi: erc20Abi, functionName: "balanceOf", args: [w.address] }),
        publicClient.readContract({ address: bondToken, abi: erc20Abi, functionName: "allowance", args: [w.address, contractAddr] }),
      ]);
      setUsdso({ balance, allowance });
    } catch {
      /* keep the last known values */
    }
  }, [contractAddr, bondToken, w.address]);
  useEffect(() => {
    setUsdso(null);
    readUsdso();
    const t = setInterval(readUsdso, 15000);
    return () => clearInterval(t);
  }, [readUsdso]);

  const capacity = parsePrice(capacityS);
  // The bond follows the capacity (2% of it, never under the minimum) until the person types their own. A bond that falls below the rule is lifted.
  useEffect(() => {
    const need = minBondFor(capacity, minBond);
    const cur = parsePrice(bondS);
    if (!bondEdited || cur === null || cur < need) setBondS(formatPrice(defaultBond(capacity, minBond)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capacity, minBond, bondEdited]);
  const bond = parsePrice(bondS);
  const entry = parsePrice(entryS);
  const stop = parsePrice(stopS);
  const target = parsePrice(targetS);
  const v = validatePrices({ isLong, entry, stop, target });
  const offTick = [entry, stop, target].some((p) => p !== null && tick > 0n && p % tick !== 0n);
  const problems = [...v.problems];
  if (offTick) problems.push(`This market only accepts prices in steps of ${formatPrice(tick)}. Use "Round to this market's steps" above.`);
  if (bond === null) problems.push("Enter a bond amount.");
  if (customOn && customSecs > 0 && customSecs < 300) problems.push("A call needs to stay open for at least 5 minutes, so followers have time to take it.");
  if (customOn && !(customSecs > 0)) problems.push("Enter how long the call stays open.");
  problems.push(...validatePostRules({ isLong, entry, stop, target, mark, capacity, bond, minBond, expirySecs: expiry }));
  if (bond !== null && usdso && usdso.balance < bond) {
    problems.push(`You need ${formatDisplay(bond, 2)} USDso for this bond and have ${formatDisplay(usdso.balance, 2)}. Get test USDso in the dreamDEX testnet app, then try again.`);
  }
  const needsApproval = bond !== null && usdso !== null && usdso.allowance < bond;
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

  const valid = v.ok && !!market && bond !== null && problems.length === 0;
  const lowUsdso = !!w.address && usdso !== null && bond !== null && usdso.balance < bond;
  // Rule problems show as soon as the three levels are in, so nobody finds out at the wallet.
  const showProblems = touched || (entry !== null && stop !== null && target !== null);

  async function post() {
    setTouched(true);
    setErr(null);
    if (!valid || !market || entry === null || stop === null || target === null || capacity === null) {
      // Never fail silently: take the user to the reason the post is blocked.
      requestAnimationFrame(() => {
        problemsRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        problemsRef.current?.focus();
      });
      return;
    }
    if (!contract) {
      setErr("Posting is not switched on yet. The CallBook contract address is not set.");
      return;
    }
    const wc = w.client();
    if (!wc || !w.address) return;
    const tid = toast.show({ tone: "pending", text: "Confirm in your wallet." });
    try {
      if (w.wrongChain) await w.switchChain();
      if (bond === null) throw new Error("bond");
      // The page-load read can lose to a slow RPC; fetch the bond token now if it is missing.
      const token =
        bondToken ??
        ((await withRetry(() => publicClient.readContract({ address: contract, abi: callBookAbi, functionName: "bondToken" }), 3)) as `0x${string}`);
      if (!bondToken) setBondToken(token);
      // Step 1 (only when needed): allow CallBook to take the bond. Step 2: post the call.
      const allowance = (await withRetry(() => publicClient.readContract({ address: token, abi: erc20Abi, functionName: "allowance", args: [w.address!, contract] }), 3)) as bigint;
      if (allowance < bond) {
        setBusy("approve");
        const aArgs = [contract, bond] as const;
        const aEst = await publicClient.estimateContractGas({ address: token, abi: erc20Abi, functionName: "approve", args: aArgs, account: w.address });
        const aHash = await wc.writeContract({ address: token, abi: erc20Abi, functionName: "approve", args: aArgs, gas: aEst * 2n, account: w.address, chain: wc.chain });
        setBusy("chain");
        toast.update(tid, { text: "Bond approval submitted. Waiting for confirmation.", hash: aHash });
        const aRc = await publicClient.waitForTransactionReceipt({ hash: aHash });
        if (aRc.status !== "success") throw new Error("approve reverted");
        toast.update(tid, { text: "Bond approved. Now confirm the call in your wallet.", hash: undefined });
      }
      setBusy("wallet");
      // The contract checks expiry against block.timestamp, and testnet block time drifts from wall time.
      const chainNow = await withRetry(() => chainTimeExact(), 3);
      const args = [market.pool as `0x${string}`, isLong, entry, stop, target, BigInt(chainNow + expiry), note.trim(), capacity, bond] as const;
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
      toast.update(tid, { text: "Call submitted. Waiting for confirmation.", hash });
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
      toast.update(tid, { tone: "ok", text: "Your call is live.", hash });
      setPosted({ id, hash, snap: { market: market.name, isLong, entry, stop, target, dp, note: note.trim(), bond, capacity, secsLeft: expiry } });
      setShareOpen(true);
    } catch (e) {
      console.error("post failed", e);
      const d = describeError(e);
      if (d.kind === "error") {
        setErr(d.message);
        toast.update(tid, { tone: "warn", text: d.message, hash: undefined });
      } else toast.dismiss(tid);
    } finally {
      setBusy(null);
    }
  }

  if (posted) {
    const link = posted.id !== null ? `/c/${posted.id}` : null;
    const sn = posted.snap;
    const cardModel =
      posted.id !== null
        ? callCardModel({ id: posted.id, market: sn.market, isLong: sn.isLong, entry: sn.entry, stop: sn.stop, target: sn.target, dp: sn.dp, outcome: "open", caller: w.address ?? "0x0000000000000000000000000000000000000000", bond: sn.bond, capacity: sn.capacity, result: null, record: null })
        : null;
    return (
      <div className="wrap">
        <div className="empty">
          <h1>Your call is on the record.</h1>
          <p>It is written on chain and cannot be edited. Share the link and anyone can see it.</p>
          <NextStep tone="go">Share it so others can take it.</NextStep>
          <div className="actions">
            {cardModel && (
              <button type="button" className="btn btn-primary" onClick={() => setShareOpen(true)}>
                Share your call
              </button>
            )}
            {link && (
              <Link className="btn" href={link}>
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
              setShareOpen(false);
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
        {shareOpen && cardModel && <ShareSheet title="Your call is live" intro="It is on chain and cannot be edited. Share it so followers can take it." model={cardModel} openHref={link ?? undefined} onClose={() => setShareOpen(false)} />}
      </div>
    );
  }

  const nEntry = entry !== null ? toNumber(entry) : null;
  const nStop = stop !== null ? toNumber(stop) : null;
  const nTarget = target !== null ? toNumber(target) : null;
  const showLadder = nEntry !== null && nStop !== null && nTarget !== null && v.ok;

  let cta = "Post call";
  if (busy === "approve") cta = "Step 1 of 2: allow the bond in your wallet...";
  if (busy === "wallet") cta = needsApproval ? "Step 2 of 2: confirm the call in your wallet..." : "Confirm in your wallet...";
  if (busy === "chain") cta = "Writing to the chain...";

  const priceFields = [
    { lab: "Entry", val: entryS, set: setEntryS, bad: entry === null && touched },
    { lab: "Stop loss", val: stopS, set: setStopS, bad: stop === null && touched },
    { lab: "Take profit", val: targetS, set: setTargetS, bad: target === null && touched },
  ];

  const composerNext = !w.address ? (
    <>Connect your wallet to post or take.</>
  ) : usdso !== null && usdso.balance < minBond ? (
    <>
      You need test USDso for the bond.{" "}
      <a href={DREAMDEX_APP_URL} target="_blank" rel="noopener noreferrer">
        Get some in the dreamDEX testnet app
      </a>
      , then come back.
    </>
  ) : null;

  return (
    <div className="wrap">
      <section className="hero">
        <h1>Post a call. Let anyone take it.</h1>
        <p>Write your trade once. It goes on the record where it cannot be edited, and followers can take it with your stop and target already set.</p>
      </section>
      {composerNext && <NextStep>{composerNext}</NextStep>}
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
                <span className={`live-dot ${stale || sel.stale ? "is-stale" : ""}`} />
                Live price {formatDisplay(mark, dp)}
                {liveSel && liveSel.readAt > 0 ? `, ${ageLabel(markAgeSec(liveSel.readAt, nowMs))}` : ""}
              </p>
            )}
            {market && liveSel && !priceOk && <p className="hint">{STALE_PRICE_COPY}. You can still type your own entry.</p>}
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
            <button type="button" className="linklike" onClick={useMark} disabled={mark === null || !priceOk}>
              Use live price as entry
            </button>
            {/* Only offered when a price is actually between two allowed steps; otherwise it would do nothing. */}
            {offTick && tick > 0n && (
              <button type="button" className="linklike" onClick={snap}>
                Round to this market&apos;s {formatPrice(tick)} steps
              </button>
            )}
          </div>

          <div className="field">
            <span className="label" id="exp-l">
              Call stays open for
            </span>
            <div className="chips" role="group" aria-labelledby="exp-l">
              {EXPIRIES.map((x) => (
                <button type="button" key={x.secs} className="chip" aria-pressed={!customOn && presetExpiry === x.secs} onClick={() => setExpiry(x.secs)}>
                  {x.label}
                </button>
              ))}
              <button type="button" className="chip" aria-pressed={customOn} onClick={() => setCustomOn(true)}>
                Custom
              </button>
            </div>
            {customOn && (
              <div className="custom-expiry">
                <input
                  className="input num"
                  inputMode="decimal"
                  aria-label="Custom duration"
                  value={customVal}
                  onChange={(e) => setCustomVal(e.target.value.replace(/[^\d.]/g, ""))}
                />
                <select className="select" aria-label="Unit" value={customUnit} onChange={(e) => setCustomUnit(e.target.value as "minutes" | "hours" | "days")}>
                  <option value="minutes">minutes</option>
                  <option value="hours">hours</option>
                  <option value="days">days</option>
                </select>
                <span className="hint">From 5 minutes to 30 days.</span>
              </div>
            )}
          </div>

          <div className="field">
            <div className="field-head">
              <label className="label" htmlFor="capacity">
                Follower capacity (USDso)
              </label>
              <span className="hint num">bond is 2% of this</span>
            </div>
            <input
              id="capacity"
              className="input num"
              inputMode="decimal"
              autoComplete="off"
              value={capacityS}
              aria-invalid={touched && (capacity === null || capacity <= 0n)}
              onChange={(e) => setCapacityS(e.target.value.replace(/[^\d.]/g, ""))}
            />
            <p className="hint">The most trade size your bond covers across everyone who takes this call. Once it is full, the app stops new takes.</p>
          </div>

          <div className="field">
            <div className="field-head">
              <label className="label" htmlFor="bond">
                Bond (USDso)
              </label>
              <span className="hint num">min {formatDisplay(minBondFor(capacity, minBond), 2)}</span>
            </div>
            <input
              id="bond"
              className="input num"
              inputMode="decimal"
              autoComplete="off"
              value={bondS}
              aria-invalid={touched && bond === null}
              onChange={(e) => {
                setBondEdited(true);
                setBondS(e.target.value.replace(/[^\d.]/g, ""));
              }}
            />
            <p className="hint">Your bond backs the call. Hit the target: it comes back. Stopped: it goes to the people who took it. Expired: it&apos;s settled at the price; if the market moved against your call, takers get a share.</p>
            {usdso && (
              <p className="hint num">
                Your USDso: {formatDisplay(usdso.balance, 2)}.{" "}
                {usdso.balance < minBond && (
                  <a href={DREAMDEX_APP_URL} target="_blank" rel="noopener noreferrer">
                    Get test USDso
                  </a>
                )}
              </p>
            )}
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

          {showProblems && problems.length > 0 && (
            <ul className="problems" role="alert" ref={problemsRef} tabIndex={-1}>
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
          {w.address && !w.wrongChain && usdso !== null && (
            <p className="hint">
              {needsApproval ? "Your wallet will ask twice: first to allow your bond (USDso), then to post the call." : "Your wallet will ask once, to post the call and move your bond."}
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
          ) : lowUsdso ? (
            <>
              <a className="btn btn-primary btn-wide" href={DREAMDEX_APP_URL} target="_blank" rel="noopener noreferrer">
                Get test USDso to post
              </a>
              <p className="hint" style={{ textAlign: "center" }}>
                Your bond is {formatDisplay(bond ?? 0n, 2)} USDso and this wallet has {formatDisplay(usdso?.balance ?? 0n, 2)}. Claim practice USDso in the dreamDEX testnet app, then come back. Your call stays filled in.
              </p>
            </>
          ) : (
            <button type="submit" className="btn btn-primary btn-wide" disabled={busy !== null}>
              {cta}
            </button>
          )}
        </form>

        <aside className="desk-aside stack" aria-label="Preview">
          <Ticket preview market={market?.name ?? "Pick a market"} isLong={isLong} entry={entry} stop={stop} target={target} dp={dp} note={note} secsLeft={expiry} capacity={capacity} />
          {market && (
            <PriceChartLazy pool={market.pool} isLong={isLong} entry={nEntry} stop={nStop} target={nTarget} mark={mark !== null ? toNumber(mark) : null} dp={dp} />
          )}
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
