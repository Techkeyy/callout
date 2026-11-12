"use client";
import { useEffect, useLayoutEffect, useState } from "react";
import type { CardModel, Num, Stat, Tone } from "@/lib/cardmodel";

const reduced = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function fmt(n: Num, x: number): string {
  const body = Math.abs(x).toLocaleString("en-US", { minimumFractionDigits: n.dp, maximumFractionDigits: n.dp });
  const sign = x < 0 && Number(body.replace(/,/g, "")) !== 0 ? "-" : n.plus && x > 0 ? "+" : "";
  return `${sign}${body}${n.suffix ?? ""}`;
}

/** The text of a number that counts up from zero. With reduced motion, or no `num`, it is the final text from the first frame. */
function useCount(num: Num | undefined, final: string, run: boolean, delay: number): string {
  const [text, setText] = useState(final);
  useLayoutEffect(() => {
    if (!num || !run || reduced()) {
      setText(final);
      return;
    }
    setText(fmt(num, 0));
    let raf = 0;
    let start = 0;
    const dur = 900;
    const tick = (t: number) => {
      if (!start) start = t;
      const p = Math.min(1, Math.max(0, (t - start - delay) / dur));
      const eased = 1 - Math.pow(1 - p, 3);
      setText(p >= 1 ? final : fmt(num, num.to * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [num?.to, num?.dp, final, run, delay]);
  return text;
}

function Counted({ s, delay, run, className }: { s: Stat; delay: number; run: boolean; className?: string }) {
  const t = useCount(s.num, s.v, run, delay);
  return <span className={className}>{t}</span>;
}

const tone = (t: Tone | undefined) => (t ? ` t-${t}` : "");

/**
 * The share card in HTML and CSS: the same design as the 1200x630 image (src/lib/ogcard.tsx), drawn from the same model.
 * Sizes are in container units of a 1200 wide card, so it scales to any width. The ticket slides in, the stamp slams,
 * numbers count up. With prefers-reduced-motion there is no motion and the final values show at once.
 */
export default function ShareCard({ model, animate = true }: { model: CardModel; animate?: boolean }) {
  const [on, setOn] = useState(false);
  useEffect(() => setOn(animate), [animate]);
  const m = model;
  const hl = m.headline.length;
  const hs = m.kind === "call" ? (hl <= 10 ? "xl" : "l") : hl <= 14 ? "l" : hl <= 20 ? "m" : "s";
  const dense = m.cells.length >= 5;
  return (
    <div className="sc" role="img" aria-label={`${m.headline}${m.sub ? `. ${m.sub}` : ""}${m.big ? `. ${m.big.k} ${m.big.v}` : ""}`}>
      <div className={`sc-ticket${animate ? " is-anim" : ""}`}>
        <div className="sc-slip">
          <span className="sc-notch is-l" />
          <span className="sc-notch is-r" />
          <div className="sc-main">
            <div className="sc-left">
              <div className="sc-brand">
                <svg viewBox="0 0 22 22" aria-hidden="true">
                  <rect x="1" y="3" width="20" height="16" rx="3" fill="#FF4D1C" stroke="#141414" strokeWidth="1.6" />
                  <path d="M14 3v16" stroke="#141414" strokeWidth="1.6" strokeDasharray="2.5 2" />
                </svg>
                <b>Callout</b>
                <span className="sc-eyebrow">{m.eyebrow}</span>
              </div>
              <div className={`sc-head h-${hs}`}>{m.headline}</div>
              {m.sub && <div className={`sc-sub${tone(m.subTone)}`}>{m.sub}</div>}
              {m.big && (
                <div className="sc-bigrow">
                  <Counted s={m.big} run={on} delay={350} className={`sc-big num${tone(m.big.tone)}`} />
                  <div className="sc-bigtxt">
                    <span className="sc-bigk">{m.big.k}</span>
                    {m.big.note && <span className="sc-bign">{m.big.note}</span>}
                  </div>
                </div>
              )}
              {m.cells.length > 0 && (
                <div className={`sc-cells${m.big ? " has-big" : ""}${dense ? " is-dense" : ""}`}>
                  {m.cells.map((c, i) => (
                    <div key={c.k} className="sc-cell">
                      <span className="sc-ck">{c.k}</span>
                      <Counted s={c} run={on} delay={500 + i * 80} className={`sc-cv num${tone(c.tone)}`} />
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="sc-band">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/hero-megaphone.jpg" alt="" className="sc-art" />
            </div>
            <span className={`sc-stamp is-${m.tone}${m.stamp.length > 7 ? " is-wordy" : ""}`}>{m.stamp}</span>
          </div>
          <div className="sc-foot">
            <div className="sc-fl">
              <span className="sc-fk">{m.footL.k}</span>
              <span className="sc-fv num">{m.footL.v}</span>
              {m.footL.v2 && <span className="sc-f2">{m.footL.v2}</span>}
            </div>
            <div className="sc-tag">Call it. Back it. Prove it.</div>
            <div className="sc-fr">
              <span className="sc-fk">{m.footR.k}</span>
              <span className="sc-fv num">{m.footR.v}</span>
              {m.footR.v2 && <span className="sc-f2">{m.footR.v2}</span>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
