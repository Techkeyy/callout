"use client";
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
  MIN_STT_FOR_TAKE,
  marginPlan,
  notionalOf,
  notionalToQuantity,
  pnlPercent,
  STEP_ORDER,
  unrealizedPnl,
  type Step,
} from "@/lib/take";
import * as dex from "@/lib/dex";

interface Props {
  callId: string;
  caller: `0x${string}`;
  isLong: boolean;
  entry: bigint;
  stop: bigint;
  target: bigint;
  status: "open" | "expired" | "closed";
  market: ClientMarket | null;
  /** Called after a take or a close so the card's counters refresh. */
  onChanged: () => void;
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

export default function TakePanel({ callId, caller, isLong, entry, stop, target, status, market, onChanged }: Props) {
  const w = useWallet();
  const [rd, setRd] = useState<dex.Readiness | null>(null);
  const [pos, setPos] = useState<dex.PositionRead | null>(null);
  const [legs, setLegs] = useState<dex.BracketLeg[] | null>(null);
  const [limit, setLimit] = useState<dex.SizeLimit | null>(null);
  const [preset, setPreset] = useState<number | "custom">(25);
  const [custom, setCustom] = useState("");
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
  const rules = market ? { baseDecimals: market.baseDecimals, lotSize: market.lotSize, minQuantity: market.minQuantity, maxQuantity: limit?.maxQuantity ?? null } : null;
  const qty = market && rules && notionalUsd > 0 ? notionalToQuantity(BigInt(Math.round(notionalUsd * 100)) * (E18 / 100n), market.markPrice, rules) : 0n;
  const qtyNotional = market ? notionalOf(qty, market.markPrice, market.baseDecimals) : 0n;
  // The chain reports the lock for the largest order, so scale it to this size. Without it, assume 20% of the notional.
  const marginNeeded =
    limit?.lockAmount && limit.maxQuantity && limit.maxQuantity > 0n ? (limit.lockAmount * qty + limit.maxQuantity - 1n) / limit.maxQuantity : qtyNotional / 5n;

  const refresh = useCallback(async () => {
    const c = ctx();
    if (!c) return;
    try {
      const mark = c.market.markPrice;
      const [r, p, l, s] = await Promise.all([
        dex.readReadiness({ ...c, builder: caller }),
        dex.readPosition(c),
        dex.readBracket(c).catch(() => null),
        dex.readSizeLimit(c, isLong, crossingPrice(mark, c.market.tickSize, isLong)).catch(() => null),
      ]);
      setRd(r);
      setPos(p);
      setLegs(l);
      setLimit(s);
    } catch {
      /* keep the last known state; the next refresh retries */
    }
  }, [ctx, caller, isLong]);

  useEffect(() => {
    setRd(null);
    setPos(null);
    setLegs(null);
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
  const block = blockReason({ status, isCaller, wrongNetwork: w.wrongChain, isLong, mark, stop, target });
  const step: Step = deriveStep({
    connected: !!w.address,
    stt: rd?.stt ?? null,
    margin: rd?.margin ?? null,
    marginNeeded,
    approval: rd?.builderApproval ?? null,
    hasPosition,
  });

  async function run(kind: Exclude<Busy, null>, fn: (c: dex.Ctx) => Promise<void>) {
    const c = ctx();
    if (!c) return;
    setMsg(null);
    setBusy(kind);
    try {
      if (w.wrongChain) await w.switchChain();
      await fn(c);
    } catch (e) {
      const d = describeTakeError(e);
      setMsg(d.kind === "rejected" ? { tone: "info", text: "Nothing changed." } : { tone: "warn", text: d.message });
    } finally {
      setBusy(null);
      refresh();
    }
  }

  const doDeposit = () =>
    run("deposit", async (c) => {
      const need = marginNeeded > (rd?.margin ?? 0n) ? marginNeeded - (rd?.margin ?? 0n) : 0n;
      const amount = need + need / 10n + 1n; // a little headroom for price moves
      await dex.depositMargin(c, amount > (rd?.walletUsdso ?? 0n) ? (rd?.walletUsdso ?? 0n) : amount);
      setMsg({ tone: "ok", text: "Margin added." });
    });
  const doVoucher = () =>
    run("voucher", async (c) => {
      await dex.claimVoucher(c);
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
            <dd className="dist-v" style={{ margin: 0 }}>{legs === null ? "Checking..." : bracketOk ? "Stop and target are set" : "Not set"}</dd>
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
              <button className="btn btn-primary btn-wide" onClick={w.connect} disabled={!w.hasWallet || w.connecting}>
                {w.hasWallet ? "Connect wallet" : "Install a wallet to take calls"}
              </button>
            </>
          )}
          {w.address && !rd && <div className="skeleton" style={{ height: 52 }} aria-label="Checking your account" />}

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
                  <p className="hint">You have no USDso to deposit. Get test USDso on dreamDEX, then check again.</p>
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
              <p className="hint">The caller earns 0.1% of this trade (${formatDisplay(callerFee(qtyNotional), 2)}). It is the only fee.</p>
              {limit && !limit.placeable && (
                <p className="notice is-warn">
                  {limit.limitedBy === "voucherBlocked" ? "Practice USDso cannot be used on this market. Deposit real test USDso instead." : "This size cannot be placed right now. Try a smaller size."}
                </p>
              )}
              <p className="hint">Your wallet will ask twice: first to open the position, then to set the stop at {formatDisplay(stop, dp)} and the target at {formatDisplay(target, dp)}.</p>
              <button className="btn btn-primary btn-wide" onClick={doTake} disabled={busy !== null || qty === 0n || (limit !== null && !limit.placeable)}>
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
