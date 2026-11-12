"use client";
import { useToast } from "./Toast";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatUnits } from "viem";
import { useWallet } from "@/lib/wallet";
import type { ClientMarket } from "@/lib/useMarkets";
import { publicClient, readClaimable, readCovered, readResult, readTakes } from "@/lib/calls";
import { txUrl } from "@/lib/chain";
import { formatHeld, isVerifiedClose, realizedPercent } from "@/lib/fills";
import { closedViewOf, isClosed, loadTrade, parseTxHash, saveTrade, takePatch, totalFees, type ClosedView } from "@/lib/trade";
import { takerPayoutOf } from "@/lib/cardmodel";
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
  /** The wallet's verified closed trade on this call (null when none), for the closed taker share card. */
  onClosed?: (c: { entry: bigint; exit: bigint; realizedPnl: bigint; pct: number; closeTx: string } | null) => void;
  /** Open the share sheet for the closed trade. */
  onShareClosed?: () => void;
}

const PRESETS = [25, 50, 100];
const STEP_LABEL: Record<string, string> = { connect: "Connect", gas: "Get set up", margin: "Add margin", approve: "Approve caller", take: "Take" };
const E18 = 10n ** 18n;

type Busy = null | "deposit" | "voucher" | "approve" | "take" | "arm" | "close" | "check" | "withdraw";

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
  withdraw: "Withdrawn to your wallet.",
};

/** "+$0.12", "-$1.30", "$0.00". Four decimals under a cent so a small amount never reads as zero. */
function money(v: bigint, signed = false): string {
  const abs = v < 0n ? -v : v;
  const dp = abs !== 0n && abs < E18 / 100n ? 4 : 2;
  return `${signed ? (v > 0n ? "+" : v < 0n ? "-" : "") : ""}$${formatDisplay(abs, dp)}`;
}

export default function TakePanel({ callId, caller, isLong, entry, stop, target, status, market, remaining, onChanged, onTaken, onPosition, onClosed, onShareClosed }: Props) {
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
  const [closed, setClosed] = useState<ClosedView | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [payout, setPayout] = useState<{ amount: bigint | null; claimable: bigint | null } | null>(null);
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
    withdraw: "Withdrawing to your wallet. Confirm in your wallet.",
  };
  async function run(kind: Exclude<Busy, null>, fn: (c: dex.Ctx) => Promise<void | string>) {
    const c = ctx();
    if (!c) return;
    setMsg(null);
    setBusy(kind);
    const tid = toast.show({ tone: "pending", text: PENDING[kind] ?? "Confirm in your wallet." });
    try {
      if (w.wrongChain) await w.switchChain();
      const done = await fn(c);
      toast.update(tid, { tone: "ok", text: done || (DONE[kind] ?? "Done.") });
    } catch (e) {
      console.error(`[callout] ${kind} failed`, e);
      const d = describeTakeError(e, kind);
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
      setClosed(null);
      setDismissed(false);
      saveTakeLocally(c, res);
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
      const res = await dex.closePosition(c, pos);
      // The result comes straight from the close receipt, so it shows the moment the position is gone.
      let toastText: string | undefined;
      if (res.after.size === 0n) {
        const view = closedViewOf({ closeTx: res.hash, isLong, summary: res.summary, closedAt: res.closedAt, stored: loadTrade(callId, c.account), baseDecimals: c.market.baseDecimals });
        if (view) {
          saveTrade(callId, c.account, { closeTx: res.hash, ...(res.closedAt !== null ? { closedAt: res.closedAt } : {}), exitAvg: view.exit.toString(), realizedPnl: view.realizedPnl.toString(), closeFee: view.closeFee.toString(), closeQty: view.qty.toString(), ...(view.entry !== null ? { entryAvg: view.entry.toString() } : {}) });
          setClosed(view);
          setDismissed(false);
          toastText = `Position closed. Realized P&L ${money(view.realizedPnl, true)}.`;
        }
      }
      setPos(res.after);
      const live = await dex.readBracket(c).catch(() => []);
      if (live.length > 0) await dex.cancelBracket(c, live);
      setMsg({ tone: "ok", text: "Position closed. Your stop and target were cancelled and the locked STT is back." });
      onChanged();
      return toastText;
    });
  const doWithdraw = () =>
    run("withdraw", async (c) => {
      const amount = rd?.withdrawable ?? 0n;
      if (amount <= 0n) throw new Error("Nothing to withdraw.");
      await dex.withdrawAll(c, amount);
    });

  /** Remember the take on this device, so the closed-trade result can show the entry, the fees and how long it was held. */
  function saveTakeLocally(c: dex.Ctx, res: Awaited<ReturnType<typeof dex.takeCall>>) {
    const prev = loadTrade(callId, c.account);
    const { patch, fresh } = takePatch(prev, { takeTx: res.hash, openedAt: res.openedAt, entryAvg: res.after.avgEntryPrice, size: res.after.size, openFee: res.summary.fee, builderFee: res.summary.builderFee });
    saveTrade(callId, c.account, patch, { fresh });
  }

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

  // A closed trade for this call: from this device's storage and/or the ?close=<tx> link, always checked against the chain.
  useEffect(() => {
    if (!w.address || !market) return;
    const wallet = w.address;
    const m = market;
    const stored = loadTrade(callId, wallet);
    let urlTx: `0x${string}` | null = null;
    try {
      urlTx = parseTxHash(new URLSearchParams(window.location.search).get("close"));
    } catch {
      urlTx = null;
    }
    // A saved trade that is still open wins over an old link: the link would show a trade that is not the current one.
    const tx = isClosed(stored) ? (stored.closeTx as `0x${string}`) : stored?.takeTx ? null : urlTx;
    if (!tx) {
      setClosed(null);
      return;
    }
    let alive = true;
    // Show what was saved at once; the chain then confirms or replaces it.
    if (isClosed(stored) && stored.exitAvg && stored.realizedPnl && stored.closeQty) {
      const entry = stored.entryAvg ? BigInt(stored.entryAvg) : null;
      const qty = BigInt(stored.closeQty);
      setClosed((cur) => cur ?? {
        closeTx: tx,
        isLong,
        entry,
        exit: BigInt(stored.exitAvg!),
        qty,
        realizedPnl: BigInt(stored.realizedPnl!),
        closeFee: BigInt(stored.closeFee ?? "0"),
        openFee: stored.openFee !== undefined ? BigInt(stored.openFee) : null,
        builderFee: stored.builderFee !== undefined ? BigInt(stored.builderFee) : null,
        openedAt: stored.openedAt ?? null,
        closedAt: stored.closedAt ?? null,
        pct: entry ? realizedPercent(BigInt(stored.realizedPnl!), entry, qty, m.baseDecimals) : null,
      });
    }
    (async () => {
      try {
        const receipt = await withRetry(() => withTimeout(publicClient.getTransactionReceipt({ hash: tx }), 15000), 2, 800);
        const summary = isVerifiedClose(receipt as never, wallet, m.pool, m.marginBank as `0x${string}`);
        if (!summary) {
          if (alive && !isClosed(stored)) setClosed(null);
          return;
        }
        const closedAt = await dex.blockTime(publicClient as never, receipt.blockNumber);
        const view = closedViewOf({ closeTx: tx, isLong, summary: summary, closedAt, stored, baseDecimals: m.baseDecimals });
        if (!alive || !view) return;
        setClosed(view);
        if (!isClosed(stored)) saveTrade(callId, wallet, { closeTx: tx, ...(closedAt !== null ? { closedAt } : {}), exitAvg: view.exit.toString(), realizedPnl: view.realizedPnl.toString(), closeFee: view.closeFee.toString(), closeQty: view.qty.toString(), ...(view.entry !== null ? { entryAvg: view.entry.toString() } : {}) });
      } catch {
        /* the chain could not be reached: keep what was saved, if anything */
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w.address, pool, callId]);

  const showClosed = !!closed && !dismissed && !hasPosition && pos !== null;
  const closedTx = closed?.closeTx ?? null;
  // The bond payout is a different thing from the trade's P&L: show it on its own line.
  useEffect(() => {
    if (!showClosed || !w.address) return;
    let alive = true;
    const id = BigInt(callId);
    const who = w.address;
    (async () => {
      const [res, cov, tk, cl] = await Promise.all([readResult(id), readCovered(id, who), readTakes(id), readClaimable(id, who)]);
      if (!alive) return;
      const r = res && res.outcome !== "open" ? { price: res.price, forfeit: res.forfeit } : null;
      setPayout({ amount: takerPayoutOf({ outcome: res?.outcome ?? "open", result: r, covered: cov, totalCovered: tk?.covered ?? null, claimable: cl }), claimable: cl });
    })();
    return () => {
      alive = false;
    };
  }, [showClosed, closedTx, w.address, callId]);

  // Tell the page about the verified closed trade, for the closed share card.
  useEffect(() => {
    if (!onClosed) return;
    if (showClosed && closed && closed.entry !== null && closed.pct !== null) onClosed({ entry: closed.entry, exit: closed.exit, realizedPnl: closed.realizedPnl, pct: closed.pct, closeTx: closed.closeTx });
    else onClosed(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showClosed, closedTx, closed?.pct]);

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
        {status !== "open" && (
          <p className="notice is-warn" role="status">
            This call has ended, but your position is still open on dreamDEX. {bracketOk ? "Your stop and target still protect it." : "Set a stop and target below, or close it."} Close it whenever you want: your P&amp;L becomes real when you do.
          </p>
        )}
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

  if (showClosed && closed && market) {
    const c = closed;
    const sign = c.realizedPnl > 0n ? "long" : c.realizedPnl < 0n ? "short" : undefined;
    const color = sign ? `var(--${sign})` : undefined;
    const held = c.openedAt !== null && c.closedAt !== null ? formatHeld(c.closedAt - c.openedAt) : null;
    const fees = totalFees(c);
    const net = c.openFee !== null && c.builderFee !== null ? c.realizedPnl - fees.total : null;
    return (
      <div className="panel" aria-live="polite">
        <h2>Trade closed</h2>
        <dl className="dist" style={{ marginTop: 8, borderTop: 0, paddingTop: 0 }}>
          <div>
            <dt className="dist-k">Direction and size</dt>
            <dd className="dist-v num" style={{ margin: 0 }}>
              {c.isLong ? "Long " : "Short "}
              {trimUnits(c.qty, market.baseDecimals)} {sym}
            </dd>
          </div>
          <div>
            <dt className="dist-k">Entry (avg)</dt>
            <dd className="dist-v num" style={{ margin: 0 }}>{c.entry !== null ? formatDisplay(c.entry, dp) : "-"}</dd>
          </div>
          <div>
            <dt className="dist-k">Exit (avg)</dt>
            <dd className="dist-v num" style={{ margin: 0 }}>{formatDisplay(c.exit, dp)}</dd>
          </div>
          {held && (
            <div>
              <dt className="dist-k">Held</dt>
              <dd className="dist-v num" style={{ margin: 0 }}>{held}</dd>
            </div>
          )}
          <div>
            <dt className="dist-k">Realized P&amp;L</dt>
            <dd className="dist-v num" style={{ margin: 0, color }}>
              {money(c.realizedPnl, true)}
              {c.pct !== null && ` (${c.pct > 0 ? "+" : c.pct < 0 ? "-" : ""}${Math.abs(c.pct).toFixed(2)}%)`}
            </dd>
          </div>
          <div>
            <dt className="dist-k">{fees.complete ? "Fees paid on this trade" : "Fees paid on the close"}</dt>
            <dd className="dist-v num" style={{ margin: 0 }}>{money(fees.complete ? fees.total : c.closeFee)}</dd>
          </div>
          {net !== null && (
            <div>
              <dt className="dist-k">After fees</dt>
              <dd className="dist-v num" style={{ margin: 0, color: net > 0n ? "var(--long)" : net < 0n ? "var(--short)" : undefined }}>{money(net, true)}</dd>
            </div>
          )}
          <div>
            <dt className="dist-k">Bond payout</dt>
            <dd className="dist-v num" style={{ margin: 0 }}>
              {payout === null ? "..." : payout.amount === null ? "None" : `${formatDisplay(payout.amount, 2)} USDso${payout.claimable && payout.claimable > 0n ? ", claim it above" : ""}`}
            </dd>
          </div>
        </dl>
        <p className="hint" style={{ marginTop: 8 }}>
          Realized P&amp;L is the price result the exchange reported for your close. Fees are charged on top of it.
        </p>
        <p className="num" style={{ marginTop: 12 }}>
          Back in your dreamDEX margin: {rd ? `${formatDisplay(rd.withdrawable, 2)} USDso` : "..."}
        </p>
        {msg && <p className={`notice ${msg.tone === "warn" ? "is-warn" : msg.tone === "ok" ? "is-ok" : ""}`} style={{ marginTop: 12 }} role="status">{msg.text}</p>}
        <div className="actions" style={{ marginTop: 12 }}>
          {onShareClosed && c.entry !== null && c.pct !== null && (
            <button type="button" className="btn btn-primary" onClick={onShareClosed}>
              Share your result
            </button>
          )}
          <button className="btn" onClick={doWithdraw} disabled={busy !== null || !rd || rd.withdrawable <= 0n}>
            {busy === "withdraw" ? "Waiting for your wallet..." : "Withdraw to wallet"}
          </button>
          <a className="btn" href={txUrl(c.closeTx)} target="_blank" rel="noopener noreferrer">View close transaction</a>
          {status === "open" && !block && (
            <button type="button" className="btn" onClick={() => setDismissed(true)}>
              Take it again
            </button>
          )}
        </div>
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
