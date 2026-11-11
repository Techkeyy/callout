import Link from "next/link";
import "./landing.css";
import HeroArt from "./HeroArt";
import Marquee from "./Marquee";
import RevealRoot from "./RevealRoot";
import LiveProof from "./LiveProof";
import { StepVisualBond, StepVisualPost, StepVisualSettle, StepVisualTake } from "./Visuals";
import { getCallBookAddress } from "@/lib/callbook";
import { addressUrl } from "@/lib/chain";
import { GITHUB_URL, X_PROFILE_URL } from "@/lib/share";

const STEPS = [
  { n: "1", title: "Post", body: "Write the market, direction, entry, stop, target and expiry. The card goes on chain and can never be edited.", visual: <StepVisualPost /> },
  { n: "2", title: "Bond", body: "Say how much follower size you cover, then back it with a USDso bond of at least 2% of that.", visual: <StepVisualBond /> },
  { n: "3", title: "Take", body: "Followers take it on dreamDEX perps with the stop and target already armed. You earn a 10 bps builder fee on every follower fill.", visual: <StepVisualTake /> },
  { n: "4", title: "Settle", body: "The market's on-chain mark price settles it. A hit returns your bond. A stop pays it to the people who took the call.", visual: <StepVisualSettle /> },
];

const PAYOFF = [
  { state: "HIT", tone: "hit", caller: "Whole bond back", takers: "Nothing from the bond. Their trade hit its target.", c: 100 },
  { state: "STOPPED", tone: "stopped", caller: "Nothing", takers: "The whole bond, split by how much each covered", c: 0 },
  { state: "EXPIRED, in profit", tone: "expired", caller: "Whole bond back", takers: "Nothing from the bond", c: 100 },
  { state: "EXPIRED, at a loss", tone: "expired", caller: "Bond minus a forfeit", takers: "The forfeit. The further the price moved against the call, the bigger it is.", c: 62 },
];

export default function Landing() {
  const addr = getCallBookAddress();
  return (
    <RevealRoot>
      <section className="lh" aria-labelledby="lh-title">
        <div className="lh-stage">
          <div className="lh-grid">
            <div className="lh-copy">
              <h1 id="lh-title" className="lh-title">
                <span>Call it.</span>
                <span>Back it.</span>
                <span className="lh-hl">Prove it.</span>
              </h1>
              <p className="lh-sub">
                Post a perps trade call as a card that can never be edited, with a USDso bond behind it. Followers take it with the stop and target already set. The market price settles it.
              </p>
              <div className="actions">
                <Link className="btn btn-primary btn-big" href="/app">
                  Open the app
                </Link>
                <Link className="btn btn-big lh-ghost" href="/board">
                  See the leaderboard
                </Link>
              </div>
              <p className="lh-note">Somnia Tokyo testnet. Paper USDso.</p>
            </div>
            <HeroArt />
          </div>
          <Marquee />
        </div>
      </section>

      <section className="ls ls-problem" aria-labelledby="problem-title">
        <div className="lw" data-reveal>
          <p className="ls-eyebrow">The problem</p>
          <h2 id="problem-title" className="ls-h">
            Anyone can post a trade call. Nobody pays for being wrong.
          </h2>
          <ul className="ls-list">
            <li>A post can be edited, deleted or forgotten once the move has happened.</li>
            <li>Followers copy late, by hand, and often without a stop.</li>
            <li>A caller with a bad record can start over with a new account.</li>
          </ul>
          <p className="ls-lead">Callout writes the call on chain and puts money behind it. The price decides who was right.</p>
        </div>
      </section>

      <section className="ls ls-how" aria-labelledby="how-title">
        <div className="lw">
          <p className="ls-eyebrow" data-reveal>How it works</p>
          <h2 id="how-title" className="ls-h" data-reveal>
            Four steps, all on chain.
          </h2>
          <ol className="steps4">
            {STEPS.map((s, i) => (
              <li key={s.n} className="step4" data-reveal style={{ "--d": i * 0.08 + "s" } as React.CSSProperties}>
                <div className="step4-vis">{s.visual}</div>
                <p className="step4-n num">{s.n}</p>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="ls ls-bond" aria-labelledby="bond-title">
        <div className="lw">
          <p className="ls-eyebrow" data-reveal>Who gets the bond</p>
          <h2 id="bond-title" className="ls-h" data-reveal>
            Be right and it comes back. Be wrong and followers are paid.
          </h2>
          <div className="payoff" data-reveal role="table" aria-label="Who gets the bond for each outcome">
            <div className="payoff-head" role="row">
              <span role="columnheader">Outcome</span>
              <span role="columnheader">Caller gets</span>
              <span role="columnheader">Takers get</span>
            </div>
            {PAYOFF.map((r) => (
              <div className="payoff-row" role="row" key={r.state}>
                <span className="payoff-state" role="cell">
                  <span className={"mini-stamp is-" + r.tone}>{r.state}</span>
                </span>
                <span className="payoff-cell" role="cell">
                  <span className="payoff-k">Caller gets</span>
                  {r.caller}
                </span>
                <span className="payoff-cell" role="cell">
                  <span className="payoff-k">Takers get</span>
                  {r.takers}
                </span>
                <span className="payoff-bar" aria-hidden="true">
                  <i className="is-caller" style={{ "--w": r.c + "%" } as React.CSSProperties} />
                  <i className="is-takers" style={{ "--w": 100 - r.c + "%" } as React.CSSProperties} />
                </span>
              </div>
            ))}
          </div>
          <p className="payoff-key" data-reveal>
            <span><i className="sw is-caller" /> Caller</span>
            <span><i className="sw is-takers" /> Takers</span>
            <span className="hint">The last bar is an example. The real split follows the price at expiry.</span>
          </p>
          <p className="hint" data-reveal>If nobody took the call, the bond always comes back to the caller.</p>
        </div>
      </section>

      <section className="ls ls-proof" aria-labelledby="proof-title">
        <div className="lw">
          <p className="ls-eyebrow" data-reveal>Live proof</p>
          <h2 id="proof-title" className="ls-h" data-reveal>
            Every outcome is a public on-chain transaction.
          </h2>
          <LiveProof />
          <p className="proof-addr" data-reveal>
            <span className="hint">Contract, CallBook v4</span>
            {addr ? (
              <a className="num" href={addressUrl(addr)} target="_blank" rel="noopener noreferrer">
                {addr}
              </a>
            ) : (
              <span className="num">Not connected yet</span>
            )}
          </p>
        </div>
      </section>

      <section className="ls ls-built" aria-labelledby="built-title">
        <div className="lw" data-reveal>
          <p className="ls-eyebrow">Built on</p>
          <h2 id="built-title" className="ls-h">
            dreamDEX perps and Somnia Reactivity.
          </h2>
          <div className="built">
            <div>
              <h3>dreamDEX perps</h3>
              <p>Followers trade on dreamDEX with the call&apos;s stop and target armed. Each fill carries the card&apos;s tag, so the caller earns the 10 bps builder fee.</p>
            </div>
            <div>
              <h3>Somnia Reactivity</h3>
              <p>The chain counts each take in the same block as the fill, and settles every call at its own expiry. No server, no database, no indexer.</p>
            </div>
          </div>
        </div>
      </section>

      <footer className="lf">
        <div className="lw lf-in">
          <div>
            <p className="lf-brand">Callout</p>
            <p className="lf-tag">Call it. Back it. Prove it.</p>
          </div>
          <nav aria-label="Footer" className="lf-links">
            <Link href="/app">Open the app</Link>
            <Link href="/board">Leaderboard</Link>
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
              GitHub
            </a>
            {/* The owner's X account: change X_PROFILE_URL in src/lib/share.ts. */}
            <a href={X_PROFILE_URL} target="_blank" rel="noopener noreferrer">
              X
            </a>
          </nav>
          <p className="lf-note">Callout runs on the Somnia Tokyo testnet with paper USDso. A call is written on chain and cannot be changed after it is posted.</p>
        </div>
      </footer>
    </RevealRoot>
  );
}
