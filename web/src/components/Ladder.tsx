"use client";
import { useEffect, useState } from "react";
import { ladderScale, priceToY, formatDisplay, type LadderScale } from "@/lib/prices";

interface Props {
  isLong: boolean;
  entry: number;
  stop: number;
  target: number;
  mark: number | null;
  dp: number;
}

const W = 360;
const H = 300;
const TOP = 20;
const RAIL = H - TOP * 2;
const RX = 150;

function fmt(n: number, dp: number) {
  return formatDisplay(BigInt(Math.round(n * 10 ** Math.min(dp, 8))) * 10n ** BigInt(18 - Math.min(dp, 8)), dp);
}

/** Vertical price ladder: stop, entry, target, and the live mark. Higher price is higher on the rail. */
export default function Ladder({ isLong, entry, stop, target, mark: markProp, dp }: Props) {
  // The live price changes between server render and hydration, so anything that depends on it appears after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const mark = mounted ? markProp : null;
  const vals = [entry, stop, target, ...(mark !== null ? [mark] : [])];
  const scale: LadderScale = ladderScale(vals);
  const y = (p: number) => priceToY(p, scale, RAIL, TOP);
  const yE = y(entry);
  const yS = y(stop);
  const yT = y(target);
  const yM = mark !== null ? y(mark) : null;
  const band = (a: number, b: number, cls: string) => (
    <rect x={RX - 14} y={Math.min(a, b)} width={28} height={Math.abs(a - b)} fill={cls} />
  );
  const rows: Array<{ k: string; p: number; yy: number; bold?: boolean }> = [
    { k: "Target", p: target, yy: yT },
    { k: "Entry", p: entry, yy: yE },
    { k: "Stop", p: stop, yy: yS },
  ];
  return (
    <svg className="ladder-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Price ladder. Stop ${fmt(stop, dp)}, entry ${fmt(entry, dp)}, target ${fmt(target, dp)}${mark !== null ? `, live price ${fmt(mark, dp)}` : ""}.`}>
      {band(yE, yT, "var(--long-soft)")}
      {band(yE, yS, "var(--short-soft)")}
      <line x1={RX} x2={RX} y1={TOP} y2={TOP + RAIL} stroke="var(--line-strong)" strokeWidth={2} />
      {rows.map((r) => (
        <g key={r.k}>
          <line x1={RX - 22} x2={RX + 22} y1={r.yy} y2={r.yy} stroke="var(--ink)" strokeWidth={r.k === "Entry" ? 3 : 2} strokeDasharray={r.k === "Entry" ? undefined : "5 4"} />
          <text x={RX - 30} y={r.yy + 5} textAnchor="end" fontSize={14} fontWeight={600} fill="var(--ink)">{fmt(r.p, dp)}</text>
          <text x={RX + 30} y={r.yy + 5} fontSize={14} fill="var(--ink-3)" style={{ fontFamily: "var(--font-ui)" }}>{r.k}</text>
        </g>
      ))}
      {yM !== null && mark !== null && (
        <g className="mark-g" style={{ transform: `translateY(${yM}px)` }}>
          <polygon points={`${RX - 6},0 ${RX - 20},-8 ${RX - 20},8`} fill="var(--signal)" stroke="var(--ink)" strokeWidth={1.5} />
          <polygon points={`${RX + 6},0 ${RX + 20},-8 ${RX + 20},8`} fill="var(--signal)" stroke="var(--ink)" strokeWidth={1.5} />
          <circle cx={RX} cy={0} r={6} fill="var(--signal)" stroke="var(--ink)" strokeWidth={2} />
        </g>
      )}
      <title>{`${isLong ? "Long" : "Short"} call ladder`}</title>
    </svg>
  );
}
