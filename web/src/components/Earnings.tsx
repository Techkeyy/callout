"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useWallet } from "@/lib/wallet";
import { useMarkets } from "@/lib/useMarkets";
import { publicClient } from "@/lib/calls";
import { txUrl } from "@/lib/chain";
import { formatDisplay } from "@/lib/prices";
import { describeTakeError } from "@/lib/take";
import * as dex from "@/lib/dex";

interface Props {
  address: `0x${string}`;
  /** Sum of getTakes(id).fees over the wallet's calls, from the on-chain ledger. */
  earned: string;
  takers: number;
  fills: number;
}

export default function Earnings({ address, earned, takers, fills }: Props) {
  const w = useWallet();
  const { markets } = useMarkets();
  const market = markets?.[0] ?? null; // every perp market shares one MarginBank
  const mine = !!w.address && w.address.toLowerCase() === address.toLowerCase();
  const [withdrawable, setWithdrawable] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ tone: "info" | "warn" | "ok"; text: string; hash?: string } | null>(null);

  const fx = useMemo(() => {
    const wc = mine ? w.client() : null;
    return wc ? dex.makeMarkets(wc) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine, w.address]);

  const read = useCallback(async () => {
    if (!fx || !market) return;
    try {
      const a = await fx.client.getMarginAccount(market.marginBank, address);
      setWithdrawable(a.withdrawable);
    } catch {
      /* leave as is */
    }
  }, [fx, market, address]);

  useEffect(() => {
    read();
  }, [read]);

  async function withdraw() {
    const wc = w.client();
    if (!fx || !market || !wc || !w.address || !withdrawable) return;
    setBusy(true);
    setMsg(null);
    try {
      if (w.wrongChain) await w.switchChain();
      const r = (await dex.withdrawAll({ fx, pub: publicClient as never, wc, account: w.address, market }, withdrawable)) as { hash?: string };
      setMsg({ tone: "ok", text: "Withdrawn to your wallet.", hash: r.hash });
    } catch (e) {
      const d = describeTakeError(e);
      setMsg(d.kind === "rejected" ? { tone: "info", text: "Nothing changed." } : { tone: "warn", text: d.message });
    } finally {
      setBusy(false);
      read();
    }
  }

  return (
    <section className="panel" style={{ marginBottom: "var(--s-8)" }} aria-label="Earnings">
      <h2>Earnings</h2>
      <dl className="earn" style={{ marginTop: 12 }}>
        <div>
          <dt>Earned from takes</dt>
          <dd className="num">{formatDisplay(BigInt(earned), 4)} USDso</dd>
          <dd className="hint" style={{ fontSize: "var(--t-14)", fontWeight: 400 }}>
            {takers} {takers === 1 ? "taker" : "takers"}, {fills} {fills === 1 ? "fill" : "fills"}. Counted on chain.
          </dd>
        </div>
        {mine && (
          <div>
            <dt>Withdrawable perps balance</dt>
            <dd className="num">{withdrawable === null ? "..." : `${formatDisplay(withdrawable, 4)} USDso`}</dd>
            <dd className="hint" style={{ fontSize: "var(--t-14)", fontWeight: 400 }}>Includes any margin you deposited yourself.</dd>
          </div>
        )}
      </dl>
      {mine ? (
        <>
          {msg && (
            <p className={`notice ${msg.tone === "warn" ? "is-warn" : msg.tone === "ok" ? "is-ok" : ""}`} role="status">
              {msg.text}{" "}
              {msg.hash && (
                <a href={txUrl(msg.hash)} target="_blank" rel="noopener noreferrer">
                  View transaction
                </a>
              )}
            </p>
          )}
          <div className="actions" style={{ marginTop: 12 }}>
            <button className="btn btn-primary" onClick={withdraw} disabled={busy || !withdrawable || withdrawable === 0n}>
              {busy ? "Waiting for your wallet..." : "Withdraw to wallet"}
            </button>
          </div>
          <p className="hint" style={{ marginTop: 8 }}>Your wallet will ask you to confirm one transaction.</p>
        </>
      ) : (
        <p className="hint">Only the wallet that owns these calls can see and withdraw its balance.</p>
      )}
    </section>
  );
}
