"use client";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useWallet } from "@/lib/wallet";
import { shortAddress } from "@/lib/time";
import { readBalances, type Balances } from "@/lib/balances";
import { formatDisplay } from "@/lib/prices";

const fmt = (v: bigint | null) => (v === null ? "unavailable" : formatDisplay(v, 2));

export default function Header() {
  const w = useWallet();
  const pathname = usePathname();
  const params = useSearchParams();
  const landing = pathname === "/";
  const onExplore = pathname === "/app" && params.get("tab") === "explore";
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [bal, setBal] = useState<Balances | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const loadBalances = () => {
    if (!w.address) return;
    setLoading(true);
    readBalances(w.address)
      .then(setBal)
      .finally(() => setLoading(false));
  };
  // Fresh balances every time the wallet menu opens.
  useEffect(() => {
    if (open && w.address) loadBalances();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, w.address]);
  useEffect(() => setBal(null), [w.address]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <header className="topbar">
      <div className="wrap topbar-in">
        <Link href="/" className="wordmark" aria-label="Callout home">
          <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true">
            <rect x="1" y="3" width="20" height="16" rx="3" fill="var(--signal)" stroke="var(--ink)" strokeWidth="1.6" />
            <path d="M14 3v16" stroke="var(--ink)" strokeWidth="1.6" strokeDasharray="2.5 2" />
          </svg>
          Callout
        </Link>
        <span className="nav-spacer" />
        {landing ? (
          <nav className="topnav" aria-label="Main">
            <Link className="navlink" href="/board">
              Leaderboard
            </Link>
            <Link className="btn btn-small btn-primary" href="/app">
              Open the app
            </Link>
          </nav>
        ) : (
          <nav className="topnav" aria-label="Main">
            <Link className="navlink" href="/app" aria-current={pathname === "/app" && !onExplore ? "page" : undefined}>
              App
            </Link>
            <Link className="navlink" href="/app?tab=explore" aria-current={onExplore ? "page" : undefined}>
              Explore
            </Link>
            <Link className="navlink" href="/board" aria-current={pathname === "/board" ? "page" : undefined}>
              Leaderboard
            </Link>
            {w.address && (
              <Link className="navlink" href={"/u/" + w.address} aria-current={pathname.startsWith("/u/") ? "page" : undefined}>
                Your profile
              </Link>
            )}
          </nav>
        )}
        {landing ? null : !w.address ? (
          <div className="menu-wrap" ref={ref}>
            <button
              className="btn btn-small"
              aria-expanded={w.choices.length > 1 ? open : undefined}
              onClick={() => (w.choices.length > 1 ? setOpen((o) => !o) : w.connect())}
              disabled={w.connecting}
            >
              {w.connecting ? "Connecting..." : "Connect wallet"}
            </button>
            {open && w.choices.length > 1 && (
              <div className="menu" role="menu">
                {w.choices.map((c) => (
                  <button key={c.id} role="menuitem" onClick={() => { setOpen(false); w.connect(c.id); }}>
                    {c.name}
                  </button>
                ))}
              </div>
            )}
            {w.noWallet && <p className="hint" role="status">No wallet found. Install one, then click again.</p>}
          </div>
        ) : (
          <div className="menu-wrap" ref={ref}>
            <button className="btn btn-small" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((o) => !o)}>
              <span className="num">{shortAddress(w.address)}</span>
            </button>
            {open && (
              <div className="menu" role="menu">
                {w.wrongChain && (
                  <button role="menuitem" onClick={() => { w.switchChain(); setOpen(false); }}>
                    Switch to Somnia Tokyo
                  </button>
                )}
                <div className="wallet-head">
                  <span className="num">{shortAddress(w.address)}</span>
                  <button
                    type="button"
                    className="linklike"
                    onClick={() => {
                      navigator.clipboard?.writeText(w.address!).then(() => {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                      });
                    }}
                  >
                    {copied ? "Copied" : "Copy address"}
                  </button>
                </div>
                <dl className="wallet-bal" aria-live="polite">
                  <div>
                    <dt>USDso in wallet</dt>
                    <dd className="num">{loading && !bal ? "..." : fmt(bal?.usdso ?? null)}</dd>
                  </div>
                  <div>
                    <dt>Margin on dreamDEX</dt>
                    <dd className="num">{loading && !bal ? "..." : fmt(bal?.margin ?? null)}</dd>
                  </div>
                  <div>
                    <dt>STT for gas</dt>
                    <dd className="num">{loading && !bal ? "..." : fmt(bal?.stt ?? null)}</dd>
                  </div>
                </dl>
                <p className="wallet-note">Bonds use USDso in your wallet. Takes use your margin on dreamDEX.</p>
                <button role="menuitem" onClick={loadBalances} disabled={loading}>
                  {loading ? "Refreshing..." : "Refresh balances"}
                </button>
                <Link role="menuitem" href={`/u/${w.address}`} onClick={() => setOpen(false)}>Your profile</Link>
                <button
                  role="menuitem"
                  className="menu-danger"
                  onClick={() => {
                    setOpen(false);
                    w.disconnect();
                  }}
                >
                  Disconnect
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
