"use client";
import { useState } from "react";
import { useWallet } from "@/lib/wallet";
import { callBookAbi, describeError, getCallBookAddress } from "@/lib/callbook";
import { publicClient } from "@/lib/calls";
import { txUrl } from "@/lib/chain";
import { formatDisplay } from "@/lib/prices";
import { claimCopy, deriveOutcome, resolveCopy, type Outcome } from "@/lib/outcome";
import { STALE_PRICE_COPY } from "@/lib/mark";
import type { ClientMarket } from "@/lib/useMarkets";
import { useToast, type ToastApi } from "./Toast";

type Msg = { tone: "info" | "warn" | "ok"; text: string; hash?: string };

function MsgLine({ m }: { m: Msg | null }) {
  if (!m) return null;
  return (
    <p className={`notice ${m.tone === "warn" ? "is-warn" : m.tone === "ok" ? "is-ok" : ""}`} role="status" style={{ marginTop: 12 }}>
      {m.text}{" "}
      {m.hash && (
        <a href={txUrl(m.hash)} target="_blank" rel="noopener noreferrer">
          View transaction
        </a>
      )}
    </p>
  );
}

/** Sends a CallBook write with the node's gas estimate padded 2x, and reports each stage as a toast. Returns the tx hash. */
async function send(fn: "resolve" | "claim", id: bigint, w: ReturnType<typeof useWallet>, toast: ToastApi, done: string): Promise<`0x${string}`> {
  const addr = getCallBookAddress();
  const wc = w.client();
  if (!addr || !wc || !w.address) throw new Error("no wallet");
  const tid = toast.show({ tone: "pending", text: "Confirm in your wallet." });
  try {
    if (w.wrongChain) await w.switchChain();
    const est = await publicClient.estimateContractGas({ address: addr, abi: callBookAbi, functionName: fn, args: [id], account: w.address });
    const hash = await wc.writeContract({ address: addr, abi: callBookAbi, functionName: fn, args: [id], gas: est * 2n, account: w.address, chain: wc.chain });
    toast.update(tid, { text: "Submitted. Waiting for confirmation.", hash });
    const rc = await publicClient.waitForTransactionReceipt({ hash });
    if (rc.status !== "success") throw new Error("reverted");
    toast.update(tid, { tone: "ok", text: done, hash });
    return hash;
  } catch (e) {
    const d = describeError(e);
    if (d.kind === "rejected") toast.dismiss(tid);
    else toast.update(tid, { tone: "warn", text: d.message, hash: undefined });
    throw e;
  }
}

/** "Record the outcome": any wallet can write a crossed level or an expiry to the chain. */
export function ResolvePanel(p: {
  callId: bigint;
  isLong: boolean;
  stop: bigint;
  target: bigint;
  expiresAt: number;
  nowSec: number;
  market: ClientMarket | null;
  onDone: () => void;
}) {
  const w = useWallet();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);
  const priceOk = !!p.market && p.market.markOk;
  const o = deriveOutcome({ isLong: p.isLong, mark: p.market?.markPrice ?? null, markOk: priceOk, stop: p.stop, target: p.target, nowSec: p.nowSec, expiresAtSec: p.expiresAt });
  if (o === null) return null;

  async function go() {
    setBusy(true);
    setMsg(null);
    try {
      const hash = await send("resolve", p.callId, w, toast, "Outcome recorded on chain.");
      setMsg({ tone: "ok", text: "Recorded on chain.", hash });
      p.onDone();
    } catch (e) {
      const d = describeError(e);
      setMsg(d.kind === "rejected" ? { tone: "info", text: "Nothing changed." } : { tone: "warn", text: d.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h2>Record the outcome</h2>
      <p className="hint" style={{ marginBottom: 12 }}>
        {resolveCopy(o)} Anyone can do this, and it settles the bond.
      </p>
      {!priceOk && o !== "expired" && <p className="notice is-warn">{STALE_PRICE_COPY}.</p>}
      {w.address ? (
        <>
          <p className="hint" style={{ marginBottom: 8 }}>Your wallet will ask you to confirm one transaction.</p>
          <button className="btn btn-primary" onClick={go} disabled={busy}>
            {busy ? "Waiting for your wallet..." : "Record on chain"}
          </button>
        </>
      ) : (
        <button className="btn btn-primary" onClick={() => w.connect()} disabled={w.connecting}>
          Connect wallet to record it
        </button>
      )}
      <MsgLine m={msg} />
    </div>
  );
}

/** Shown to a wallet with something to claim after the call resolved. */
export function ClaimPanel(p: {
  callId: bigint;
  outcome: Outcome;
  claimable: bigint | null;
  isCaller: boolean;
  /** True when the call is not recorded yet but the price already allows it. claim() then settles it first. */
  settleable?: boolean;
  onDone: () => void;
}) {
  const w = useWallet();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);
  const preCopy = p.outcome === "open" && p.settleable ? "This call is ready to settle. Claim records the outcome and pays out what you are owed, in one step." : null;
  const copy = preCopy ?? (p.claimable !== null ? claimCopy({ amount: p.claimable, isCaller: p.isCaller, outcome: p.outcome, usdso: formatDisplay(p.claimable, 2) }) : null);
  if (!copy && !msg) return null;

  async function go() {
    setBusy(true);
    setMsg(null);
    try {
      const hash = await send("claim", p.callId, w, toast, "Claimed. It is in your wallet.");
      setMsg({ tone: "ok", text: "Claimed. It is in your wallet.", hash });
      p.onDone();
    } catch (e) {
      const d = describeError(e);
      setMsg(d.kind === "rejected" ? { tone: "info", text: "Nothing changed." } : { tone: "warn", text: d.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h2>Claim</h2>
      {copy && (
        <>
          <p className="hint" style={{ marginBottom: 8 }}>{copy} Your wallet will ask you to confirm one transaction.</p>
          <button className="btn btn-primary" onClick={go} disabled={busy}>
            {busy ? "Waiting for your wallet..." : "Claim"}
          </button>
        </>
      )}
      <MsgLine m={msg} />
    </div>
  );
}

/** A compact Claim button for a list row: sends claim(id) and reports the result inline. */
export function ClaimButton(p: { callId: bigint; amount: bigint; onDone: () => void }) {
  const w = useWallet();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg | null>(null);

  async function go() {
    setBusy(true);
    setMsg(null);
    try {
      const hash = await send("claim", p.callId, w, toast, "Claimed. It is in your wallet.");
      setMsg({ tone: "ok", text: "Claimed.", hash });
      p.onDone();
    } catch (e) {
      const d = describeError(e);
      setMsg(d.kind === "rejected" ? { tone: "info", text: "Nothing changed." } : { tone: "warn", text: d.message });
    } finally {
      setBusy(false);
    }
  }

  if (!w.address) {
    return (
      <button className="btn" onClick={() => w.connect()} disabled={w.connecting}>
        Connect to claim
      </button>
    );
  }
  return (
    <div>
      <button className="btn btn-primary" onClick={go} disabled={busy}>
        {busy ? "Waiting for your wallet..." : `Claim ${formatDisplay(p.amount, 2)} USDso`}
      </button>
      <MsgLine m={msg} />
    </div>
  );
}
