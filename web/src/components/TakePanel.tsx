"use client";
import { useToast } from "./Toast";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatUnits } from "viem";
import { useWallet } from "@/lib/wallet";
import type { ClientMarket } from "@/lib/useMarkets";
import { publicClient } from "@/lib/calls";
import { shortAddress } from "@/lib/time";
import { formatDisplay, displayDecimals } from "@/lib/prices";
import {
  BLOCK_COPY,
  blockReason,
  callerFee,
  crossingPrice,
  deriveStep,
  describeTakeError,
  CLAIM_REFUSED_COPY,
  MIN_STT_FOR_TAKE,
  settledOr,
  withRetry,
  withTimeout,
  NEED_USDSO_COPY,
  marginPlan,
  notionalOf,
  notionalToQuantity,
  pnlPercent,
  marginForTake,
  stopBeforeLiquidation,
  STEP_ORDER,
  unrealizedPnl,
  type Step,
} from "@/lib/take";
import { capToRemaining } from "@/lib/rules";
import * as dex from "@/lib/dex";

interface Props {
  callId: string;
  caller: `0x${string}`;
  isLong: boolean;
  entry: bigint;
  stop: bigint;
  target: bigint;
  status: "open" | "expired" | "closed" | "resolved";
  market: ClientMarket | null;
  /** Notional the bond still covers (capacity minus covered), or null when the take ledger could not be read. */
  remaining: bigint | null;
  /** Called after a take or a close so the card's counters refresh. */
  onChanged: () => void;
  /** Called once after a take went through, so the page can offer to share it. */
  onTaken?: () => void;
  /** The wallet's live position on this market (null when flat or unknown), for the taker share card. */
  onPosition?: (p: { avgEntry: bigint; pnl: bigint; pct: number } | null) => void;
}

const PRESETS = [25, 50, 100];
const STEP_LABEL: Record<string, string> = { connect: "Connect", gas: "Get set up", margin: "Add margin", approve: "Approve caller", take: "Take" };
const E18 = 10n ** 18n;

type Busy = null | "deposit" | "voucher" | "approve" | "take" | "arm" | "close" | "check";

function trimUnits(v: bigint, d: number, max = 8): string {
  const s = formatUnits(v < 0n ? -v : v, d);
  const [i, f = ""] = s.split(".");
  const fr = f.slice(0, max).replace(/0+$/, "");
  return fr ? `${i}.${fr}` : i;
}

const DONE: Record<string, string> = {
  deposit: "Margin added.",
  voucher: "Practice USDso added to your margin.",
  approve: "Caller approved.",
  take: "You took the call.",
  arm: "Stop and target are set.",
  close: "Position closed.",
};

export default function TakePanel({ callId, caller, isLong, entry, stop, target, status, market, remaining, onChanged, onTaken, onPosition }: Props) {
  const w = useWallet();
  const [rd, setRd] = useState<dex.Readiness | null>(null);
  const [pos, setPos] = useState<dex.PositionRead | null>(null);
  const [legs, setLegs] = useState<dex.BracketLeg[] | null>(null);
  const [limit, setLimit] = useState<dex.SizeLimit | null>(null);
  const [imfBps, setImfBps] = useState<bigint | null>(null);
  const [mmBps, setMmBps] = useState<bigint | null>(null);
  const [readFailed, setReadFailed] = useState(false);
  const [legsFailed, setLegsFailed] = useState(false);
  const [liq, setLiq] = useState<dex.LiquidationRead | null>(null);
  const [preset, setPreset] = useState<number | "custom">(25);
  const [custom, setCustom] = useState("");
  const toast = useToast();
  const [busy, setBusy] = useState<Busy>(null);
  const [msg, setMsg] = useState<{ tone: "info" | "warn" | "ok"; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const marketRef = useRef(market);
  marketRef.current = market;

  const fx = useMemo(() => {
    const wc = w.address ? w.client() : null;
    return wc ? dex.makeMarkets(wc) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w.address]);
  const pool = market?.pool;
  const isCaller = !!w.address && w.address.toLowerCase() === caller.toLowerCase();

  const ctx = useCallback((): dex.Ctx | null => {
    const m = marketRef.current;
    const wc = w.address ? w.client() : null;
    if (!fx || !m || !wc || !w.address) return null;
    return { fx, pub: publicClient as never, wc, account: w.address, market: m };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fx, w.address]);

  const notionalUsd = preset === "custom" ? Number(custom) || 0 : preset;
  const baseRules = market ? { baseDecimals: market.baseDecimals, lotSize: market.lotSize, minQuantity: market.minQuantity, maxQuantity: null } : null;
  const wantedNotional = BigInt(Math.round(notionalUsd * 100)) * (E18 / 100n);
  // Never plan a size past what the bond covers, so nobody takes an uncovered position through the app.
  const sized = capToRemaining(wantedNotional, remaining ?? 0n);
  const desiredNotional = sized.notional;
  // Margin is judged on the size the user WANTS. The chain's max size is 0 for an account with no margin, so it must not shrink this.
  const desiredQty = market && baseRules && notionalUsd > 0 ? notionalToQuantity(desiredNotional, market.markPrice, baseRules) : 0n;
  const marginNeeded = market && desiredQty > 0n ? marginForTake(notionalOf(desiredQty, market.markPrice, market.baseDecimals), imfBps ?? undefined, market.markPrice, stop, mmBps ?? undefined) : 0n;
  // Only the order itself is clamped to what the chain says is placeable.
  const qty =
    market && baseRules && desiredQty > 0n && limit?.maxQuantity && limit.maxQuantity > 0n
      ? notionalToQuantity(desiredNotional, market.markPrice, { ...baseRules, maxQuantity: limit.maxQuantity })
      : desiredQty;
  const qtyNotional = market ? notionalOf(qty, market.markPrice, market.baseDecimals) : 0n;
  // The smallest legal order can still be bigger than what is left. That is not allowed either.
  const overCap = remaining !== null && qtyNotional > remaining;

  const refresh = useCallback(async () => {
    const c = ctx();
    if (!c) return;
    const mark = c.market.markPrice;
    const read = <T,>(fn: () => Promise<T>) => withRetry(() => withTimeout(fn(), 15000), 2, 800);
    // Every read stands alone: one slow or failed read must not hide the others.
    const [r, p, l, s, imf, mm] = await Promise.allSettled([
      read(() => dex.readReadiness({ ...c, builder: caller })),
      read(() => dex.readPosition(c)),
      read(() => dex.readBracket(c)),
      read(() => dex.readSizeLimit(c, isLong, crossingPrice(mark, c.market.tickSize, isLong))),
      read(() => dex.readImfBps(c)),
      read(() => dex.readMmBps(c)),
    ]);
    if (r.status === "fulfilled") {
      setRd(r.value);
      setReadFailed(false);
    } else {
      setReadFailed(true);
    }
    // A failed position read keeps the last known position; it never blocks the steps.
    setPos((prev) => settledOr(p, prev));
    setLegs((prev) => settledOr(l, prev));
    setLegsFailed(l.status === "rejected");
    setLimit((prev) => settledOr(s, prev));
    setImfBps((prev) => settledOr(imf, prev));
    setMmBps((prev) => settledOr(mm, prev));
  }, [ctx, caller, isLong]);

  // While the account cannot be read, keep trying every 5 seconds.
  useEffect(() => {
    if (!readFailed || !w.address) return;
    const t = setInterval(() => {
      refresh();
    }, 5000);
    return () => clearInterval(t);
  }, [readFailed, w.address, refresh]);

  useEffect(() => {
    setRd(null);
    setPos(null);
    setLegs(null);
    setReadFailed(false);
    if (w.address && pool) refresh();
  }, [w.address, pool, refresh]);

  const hasPosition = !!pos && pos.size !== 0n;
  useEffect(() => {
    if (!w.address || !pool) return;
    const t = setInterval(refresh, hasPosition ? 8000 : 20000);
    return () => clearInterval(t);
  }, [w.address, pool, hasPosition, refresh]);

  const dp = market ? displayDecimals(market.tickSize) : 2;
  const mark = market?.markPrice ?? null;
  const block = blockReason({ status, isCaller, wrongNetwork: w.wrongChain, isLong, mark, stop, target, priceOk: market?.markOk ?? true, remaining });
  const step: Step = deriveStep({
    connected: !!w.address,
    stt: rd?.stt ?? null,
    margin: rd?.margin ?? null,
    marginNeeded,
    approval: rd?.builderApproval ?? null,
    hasPosition,
  });

  // Never send the user back a step without saying why. If the margin step comes back after it
  // was done (the price moved, or the market's margin rates loaded), explain how much is missing.
  const prevStep = useRef<Step | null>(null);
  const [regressNote, setRegressNote] = useState<string | null>(null);
  useEffect(() => {
    const p = prevStep.current;
    if (step === "margin" && (p === "approve" || p === "take")) {
      const short = marginNeeded > (rd?.margin ?? 0n) ? marginNeeded - (rd?.margin ?? 0n) : 0n;
      setRegressNote("The price moved, so this size needs about $" + formatDisplay(short, 2) + " more margin. Add it below, or pick a smaller size.");
    } else if (step !== "margin") {
      setRegressNote(null);
    }
    prevStep.current = step;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // Once the margin is in, ask the chain where this size would be liquidated. Hidden if the preview is unavailable.
  const markForLiq = market?.markPrice ?? 0n;
  useEffect(() => {
    if (step !== "take" || qty === 0n || !market) {
      setLiq(null);
      return;
    }
    const c = ctx();
    if (!c) return;
    let alive = true;
    dex.previewLiquidation(c, { isLong, quantity: qty, price: crossingPrice(markForLiq, market.tickSize, isLong) }).then((r) => alive && setLiq(r));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, qty, isLong, rd?.margin]);
  const liqPrice = liq && liq.ok ? liq.price : null;
  const stopUnsafe = liq !== null && liq.ok && !stopBeforeLiquidation(isLong, stop, liq.price);

  const PENDING: Record<string, string> = {
    deposit: "Adding margin. Confirm in your wallet.",
    voucher: "Claiming practice USDso. Confirm in your wallet.",
    approve: "Approving the caller. Confirm in your wallet.",
    take: "Taking the call. Confirm in your wallet.",
    arm: "Setting your stop and target. Confirm in your wallet.",
    close: "Closing your position. Confirm in your wallet.",
  };
  async function run(kind: Exclude<Busy, null>, fn: (c: dex.Ctx) => Promise<void>) {
    const c = ctx();
    if (!c) return;
    setMsg(null);
    setBusy(kind);
    const tid = toast.show({ tone: "pending", text: PENDING[kind] ?? "Confirm in your wallet." });
    try {
      if (w.wrongChain) await w.switchChain();
      await fn(c);
      toast.update(tid, { tone: "ok", text: DONE[kind] ?? "Done." });
    } catch (e) {
      const d = describeTakeError(e);
      if (d.kind === "rejected") toast.dismiss(tid);
      else toast.update(tid, { tone: "warn", text: d.message });
      setMsg(d.kind === "rejected" ? { tone: "info", text: "Nothing changed." } : { tone: "warn", text: d.message });
    } finally {
      setBusy(null);
      refresh();
    }
  }

  const doDeposit = () =>
    run("deposit", async (c) => {
      const need = marginNeeded > (rd?.margin ?? 0n) ? marginNeeded - (rd?.margin ?? 0n) : 0n;
      const amount = need + need / 4n + 1n; // 25% headroom, so normal price moves don't undo this step
      await dex.depositMargin(c, amount > (rd?.walletUsdso ?? 0n) ? (rd?.walletUsdso ?? 0n) : amount);
      setMsg({ tone: "ok", text: "Margin added." });
    });
  const doVoucher = () =>
    run("voucher", async (c) => {
      try {
        await dex.claimVoucher(c);
      } catch (e) {
        const d = describeTakeError(e);
        if (d.kind === "rejected") throw e;
        throw new Error(CLAIM_REFUSED_COPY, { cause: "claim" });
      }
      setMsg({ tone: "ok", text: "Practice USDso added to your margin." });
    });
  const doApprove = () =>
    run("approve", async (c) => {
      await dex.approveCaller(c, caller, rd?.builderApproval ?? null);
      setMsg({ tone: "ok", text: "Caller approved." });
    });
  const doTake = () =>
    run("take", async (c) => {
      const res = await dex.takeCall(c, { callId: BigInt(callId), caller, isLong, quantity: qty });
      setPos(res.after);
      setBusy("arm");
      try {
        await dex.armBracket(c, { isLong, stop, target });
        setMsg({ tone: "ok", text: "You're in. Your stop and target are set." });
        onTaken?.();
      } catch (e) {
        const d = describeTakeError(e);
        setMsg(
          d.kind === "rejected"
            ? { tone: "warn", text: "You're in, but your stop and target are not set yet. Set them below." }
            : { tone: "warn", text: `You're in, but setting the stop and target failed. ${d.message}` },
        );
      }
      onChanged();
    });
  const doArm = () =>
    run("arm", async (c) => {
      await dex.armBracket(c, { isLong, stop, target });
      setMsg({ tone: "ok", text: "Stop and target are set." });
    });
  const doClose = () =>
    run("close", async (c) => {
      await dex.closePosition(c);
      const live = await dex.readBracket(c).catch(() => []);
      if (live.length > 0) await dex.cancelBracket(c, live);
      setMsg({ tone: "ok", text: "Position closed. Your stop and target were cancelled and the locked STT is back." });
      onChanged();
    });

  async function copyAddress() {
    if (!w.address) return;
    try {
      await navigator.clipboard.writeText(w.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  }

  // Report the live position (same numbers as the "You're in" panel) so the share card matches the app.
  const posKey = pos && market ? `${pos.size}:${pos.avgEntryPrice}:${market.markPrice}` : "none";
  useEffect(() => {
    if (!onPosition) return;
    if (pos && pos.size !== 0n && market) {
      onPosition({
        avgEntry: pos.avgEntryPrice,
        pnl: unrealizedPnl(pos.size, pos.avgEntryPrice, market.markPrice, market.baseDecimals),
        pct: pnlPercent(pos.size, pos.avgEntryPrice, market.markPrice),
      });
    } else onPosition(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posKey]);

  // ---------- render ----------
  const sym = market ? market.name.split("-")[0] : "";
  const bracketOk = (legs?.length ?? 0) >= 2;

  if (hasPosition && pos && market) {
    const pnl = unrealizedPnl(pos.size, pos.avgEntryPrice, market.markPrice, market.baseDecimals);
    const pct = pnlPercent(pos.size, pos.avgEntryPrice, market.markPrice);
    const sign = pnl > 0n ? "+" : pnl < 0n ? "-" : "";
    return (
      <div className="panel" aria-live="polite">
        <h2>You&apos;re in</h2>
        <dl className="dist" style={{ marginTop: 8, borderTop: 0, paddingTop: 0 }}>
          <div>
            <dt className="dist-k">Size</dt>
            <dd className="dist-v num" style={{ margin: 0 }}>
              {pos.size < 0n ? "Short " : "Long "}
              {trimUnits(pos.size, market.baseDecimals)} {sym}
            </dd>
          </div>
          <div>
            <dt className="dist-k">Average entry</dt>
            <dd className="dist-v num" style={{ margin: 0 }}>{formatDisplay(pos.avgEntryPrice, dp)}</dd>
          </div>
          <div>
            <dt className="dist-k">Unrealized P&amp;L</dt>
            <dd className="dist-v num" style={{ margin: 0, color: pnl > 0n ? "var(--long)" : pnl < 0n ? "var(--short)" : undefined }}>
              {sign}${formatDisplay(pnl < 0n ? -pnl : pnl, 2)} ({sign}
              {Math.abs(pct).toFixed(2)}%)
            </dd>
          </div>
          <div>
            <dt className="dist-k">Exits</dt>
            <dd className="dist-v" style={{ margin: 0 }}>{legs === null ? (legsFailed ? "Could not read yet. Retrying..." : "Checking...") : bracketOk ? "Stop and target are set" : "Not set"}</dd>
          </div>
        </dl>
        {msg && <p className={`notice ${msg.tone === "warn" ? "is-warn" : msg.tone === "ok" ? "is-ok" : ""}`} style={{ marginTop: 12 }} role="status">{msg.text}</p>}
        <div className="actions" style={{ marginTop: 12 }}>
          {legs !== null && !bracketOk && (
            <button className="btn btn-primary" onClick={doArm} disabled={busy !== null}>
              {busy === "arm" ? "Waiting for your wallet..." : "Set stop and target"}
            </button>
          )}
          <button className="btn" onClick={doClose} disabled={busy !== null}>
            {busy === "close" ? "Waiting for your wallet..." : "Close position"}
          </button>
        </div>
        <p className="hint" style={{ marginTop: 8 }}>
          Closing sells your whole {sym} position at the market and cancels your stop and target. Your wallet will ask you to confirm each step. P&amp;L stays unrealized until you close.
        </p>
      </div>
    );
  }

  const short = rd ? (marginNeeded > rd.margin ? marginNeeded - rd.margin : 0n) : 0n;
  const plan = rd ? marginPlan({ walletUsdso: rd.walletUsdso, shortfall: short, voucherEligible: rd.voucherEligible }) : "external";
  const stepIdx = STEP_ORDER.indexOf(step === "in" ? "take" : step);

  return (
    <div className="panel">
      <h2>Take this call</h2>
      <ol className="steps" aria-label="Steps">
        {STEP_ORDER.map((s, i) => (
          <li key={s} className={i < stepIdx ? "is-done" : i === stepIdx ? "is-now" : ""} aria-current={i === stepIdx ? "step" : undefined}>
            <span className="step-n num">{i < stepIdx ? "✓" : i + 1}</span>
            {STEP_LABEL[s]}
          </li>
        ))}
      </ol>

      {!block && remaining !== null && (
        <p className="hint num">
          Bond covers {formatDisplay(remaining, 2)} more USDso of takes.
        </p>
      )}
      {block ? (
        <>
          <p className={`notice ${block === "isCaller" ? "" : "is-warn"}`}>{BLOCK_COPY[block]}</p>
          {block === "wrongNetwork" && (
            <button className="btn btn-primary btn-wide" style={{ marginTop: 12 }} onClick={w.switchChain}>
              Switch to Somnia Tokyo
            </button>
          )}
        </>
      ) : !market ? (
        <div className="skeleton" style={{ height: 52 }} aria-label="Loading market" />
      ) : (
        <div className="stack" style={{ gap: 12 }}>
          {step === "connect" && !w.address && (
            <>
              <p className="hint">Your wallet will ask you to connect. Nothing is sent yet.</p>
              <button className="btn btn-primary btn-wide" onClick={() => w.connect()} disabled={w.connecting}>
                Connect wallet
              </button>
              {w.noWallet && <p className="notice is-warn" role="status">No wallet found. Install one, then click again.</p>}
            </>
          )}
          {w.address && !rd && !readFailed && <div className="skeleton" style={{ height: 52 }} aria-label="Checking your account" />}
          {w.address && !rd && readFailed && (
            <>
              <p className="notice is-warn" role="alert">
                Could not read your account from the network. Retrying...
              </p>
              <button className="btn" onClick={() => refresh()}>
                Retry
              </button>
            </>
          )}

          {rd && step === "gas" && (
            <>
              <p className="notice is-warn">
                You need a little test gas (STT) for the order and for your stop and target. You have {trimUnits(rd.stt, 18, 3)} STT and need at least {trimUnits(MIN_STT_FOR_TAKE, 18, 1)}.
              </p>
              <div className="actions">
                <a className="btn btn-primary" href={dex.STT_FAUCET_URL} target="_blank" rel="noopener noreferrer">Get free STT</a>
                <button className="btn" onClick={copyAddress}>{copied ? "Copied" : `Copy address ${shortAddress(w.address!)}`}</button>
                <button className="btn" onClick={() => run("check", async () => {})} disabled={busy !== null}>Check again</button>
              </div>
            </>
          )}

          {rd && step === "margin" && regressNote && (
            <p className="notice is-warn" role="status">
              {regressNote}
            </p>
          )}
          {rd && step === "margin" && (
            <>
              <p className="notice is-warn">
                This size locks about ${formatDisplay(marginNeeded, 2)} of margin and you have ${formatDisplay(rd.margin, 2)}.
              </p>
              {plan === "deposit" && (
                <>
                  <p className="hint">Your wallet will ask you to approve USDso, then to deposit it.</p>
                  <button className="btn btn-primary btn-wide" onClick={doDeposit} disabled={busy !== null}>
                    {busy === "deposit" ? "Waiting for your wallet..." : `Deposit ${formatDisplay(short + short / 10n + 1n > rd.walletUsdso ? rd.walletUsdso : short + short / 10n + 1n, 2)} USDso`}
                  </button>
                </>
              )}
              {plan === "voucher" && (
                <>
                  <p className="hint">Your wallet will ask you to confirm one transaction. Practice USDso cannot be withdrawn and some markets do not accept it.</p>
                  <button className="btn btn-primary btn-wide" onClick={doVoucher} disabled={busy !== null}>
                    {busy === "voucher" ? "Waiting for your wallet..." : `Claim ${formatDisplay(rd.voucherGrant, 0)} practice USDso`}
                  </button>
                </>
              )}
              {plan === "external" && (
                <>
                  <p className="hint">{NEED_USDSO_COPY}</p>
                  <div className="actions">
                    <a className="btn btn-primary" href={dex.DREAMDEX_APP_URL} target="_blank" rel="noopener noreferrer">Open dreamDEX</a>
                    <button className="btn" onClick={() => run("check", async () => {})} disabled={busy !== null}>Check again</button>
                  </div>
                </>
              )}
            </>
          )}

          {rd && step === "approve" && (
            <>
              <p className="hint">
                Your wallet will ask you to let {shortAddress(caller)} earn up to 0.1% of your fills on this market. That is the most you can ever be charged, and it is how the caller is paid.
              </p>
              <button className="btn btn-primary btn-wide" onClick={doApprove} disabled={busy !== null}>
                {busy === "approve" ? "Waiting for your wallet..." : "Approve caller"}
              </button>
            </>
          )}

          {rd && step === "take" && (
            <>
              <div className="field">
                <span className="label" id="size-l">Size</span>
                <div className="chips" role="group" aria-labelledby="size-l">
                  {PRESETS.map((p) => (
                    <button key={p} type="button" className="chip" aria-pressed={preset === p} onClick={() => setPreset(p)}>${p}</button>
                  ))}
                  <button type="button" className="chip" aria-pressed={preset === "custom"} onClick={() => setPreset("custom")}>Custom</button>
                </div>
                {preset === "custom" && (
                  <input className="input num" inputMode="decimal" aria-label="Custom size in dollars" placeholder="Dollars, e.g. 40" value={custom} onChange={(e) => setCustom(e.target.value.replace(/[^\d.]/g, ""))} />
                )}
              </div>
              <dl className="dist" style={{ marginTop: 0, paddingTop: 12 }}>
                <div>
                  <dt className="dist-k">You enter around</dt>
                  <dd className="dist-v num" style={{ margin: 0 }}>{formatDisplay(market.markPrice, dp)}</dd>
                </div>
                <div>
                  <dt className="dist-k">The caller called</dt>
                  <dd className="dist-v num" style={{ margin: 0 }}>{formatDisplay(entry, dp)}</dd>
                </div>
                <div>
                  <dt className="dist-k">Position size</dt>
                  <dd className="dist-v num" style={{ margin: 0 }}>{trimUnits(qty, market.baseDecimals)} {sym} (${formatDisplay(qtyNotional, 2)})</dd>
                </div>
                <div>
                  <dt className="dist-k">Margin it locks</dt>
                  <dd className="dist-v num" style={{ margin: 0 }}>about ${formatDisplay(marginNeeded, 2)}</dd>
                </div>
              </dl>
              {liq && liq.ok && liqPrice !== null && !stopUnsafe && (
                <p className="hint num">
                  Liquidation price about {formatDisplay(liqPrice, dp)} (your stop at {formatDisplay(stop, dp)} triggers first).
                </p>
              )}
              {stopUnsafe && liqPrice !== null && (
                <p className="notice is-warn" role="alert">
                  At this size you would be liquidated at about {formatDisplay(liqPrice, dp)}, before your stop at {formatDisplay(stop, dp)} triggers. Add about ${formatDisplay(marginNeeded > rd.margin ? marginNeeded - rd.margin : marginNeeded / 4n, 2)} more margin, or pick a smaller size.
                </p>
              )}
              <p className="hint">The caller earns 0.1% of this trade (${formatDisplay(callerFee(qtyNotional), 2)}). It is the only fee.</p>
              {limit && !limit.placeable && (
                <p className="notice is-warn">
                  {limit.limitedBy === "voucherBlocked" ? "Practice USDso cannot be used on this market. Deposit real test USDso instead." : "This size cannot be placed right now. Try a smaller size."}
                </p>
              )}
              {sized.capped && (
                <p className="notice" role="status">
                  Size capped at ${formatDisplay(sized.notional, 2)}. The bond only covers that much more.
                </p>
              )}
              {overCap && <p className="notice is-warn">The bond covers less than the smallest order. This call is as good as full.</p>}
              {qty === 0n && !overCap && <p className="notice is-warn">Enter a size in dollars to continue.</p>}
              <p className="hint">Your wallet will ask twice: first to open the position, then to set the stop at {formatDisplay(stop, dp)} and the target at {formatDisplay(target, dp)}.</p>
              <button className="btn btn-primary btn-wide" onClick={doTake} disabled={busy !== null || qty === 0n || overCap || stopUnsafe || (limit !== null && !limit.placeable)}>
                {busy === "take" || busy === "arm" ? "Waiting for your wallet..." : "Take this call"}
              </button>
            </>
          )}
        </div>
      )}
      {msg && !hasPosition && (
        <p className={`notice ${msg.tone === "warn" ? "is-warn" : msg.tone === "ok" ? "is-ok" : ""}`} style={{ marginTop: 12 }} role="status">
          {msg.text}
        </p>
      )}
    </div>
  );
}
