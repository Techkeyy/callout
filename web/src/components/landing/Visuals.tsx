// Small drawings for the four steps. They are illustrations, not live data, and carry no numbers that could pass as a real call.

const INK = "var(--ink)";
const PAPER = "var(--slip)";

/** A ticket with a tear line and three levels. */
export function StepVisualPost() {
  return (
    <svg viewBox="0 0 220 130" role="img" aria-label="A trade call ticket with entry, stop and target lines" className="vis">
      <g transform="rotate(-3 110 65)">
        <path d="M14 14h192a6 6 0 0 1 6 6v34a8 8 0 0 0 0 16v40a6 6 0 0 1-6 6H14a6 6 0 0 1-6-6V70a8 8 0 0 0 0-16V20a6 6 0 0 1 6-6z" fill={PAPER} stroke={INK} strokeWidth="2.5" />
        <path d="M150 14v102" stroke={INK} strokeWidth="2" strokeDasharray="5 5" />
        <rect x="24" y="26" width="64" height="10" rx="3" fill={INK} />
        <path d="M24 56h108" stroke="var(--short)" strokeWidth="3" strokeLinecap="round" />
        <path d="M24 74h108" stroke={INK} strokeWidth="3" strokeLinecap="round" />
        <path d="M24 92h108" stroke="var(--long)" strokeWidth="3" strokeLinecap="round" />
        <g className="slam" style={{ transformOrigin: "180px 62px" }}>
          <rect x="160" y="46" width="40" height="22" rx="3" fill="none" stroke={INK} strokeWidth="2.5" transform="rotate(-9 180 57)" />
          <text x="180" y="62" textAnchor="middle" fontSize="11" fontWeight="800" fill={INK} transform="rotate(-9 180 57)" letterSpacing="1">
            OPEN
          </text>
        </g>
      </g>
    </svg>
  );
}

/** A stack of coins. */
export function StepVisualBond() {
  const coin = (y: number, k: number) => (
    <g key={k}>
      <ellipse cx="110" cy={y + 8} rx="46" ry="14" fill={INK} />
      <ellipse cx="110" cy={y} rx="46" ry="14" fill="var(--signal)" stroke={INK} strokeWidth="2.5" />
      <ellipse cx="110" cy={y} rx="30" ry="8" fill="none" stroke={INK} strokeWidth="1.5" strokeDasharray="3 3" />
    </g>
  );
  return (
    <svg viewBox="0 0 220 130" role="img" aria-label="A stack of bond coins" className="vis">
      {[104, 88, 72, 56].map((y, k) => coin(y, k))}
      <text x="110" y="62" textAnchor="middle" fontSize="13" fontWeight="800" fill={INK} fontFamily="var(--font-num)">
        USDso
      </text>
    </svg>
  );
}

/** A price line with the stop and target already armed. */
export function StepVisualTake() {
  return (
    <svg viewBox="0 0 220 130" role="img" aria-label="A price path with a target line above and a stop line below, both armed" className="vis">
      <path d="M12 20h196" stroke="var(--long)" strokeWidth="2.5" strokeDasharray="6 4" />
      <path d="M12 112h196" stroke="var(--short)" strokeWidth="2.5" strokeDasharray="6 4" />
      <path d="M16 90 L56 76 L86 84 L120 58 L150 64 L196 36" fill="none" stroke={INK} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="16" cy="90" r="6" fill={INK} />
      <text x="14" y="14" fontSize="11" fontWeight="700" fill="var(--long)">
        target armed
      </text>
      <text x="14" y="126" fontSize="11" fontWeight="700" fill="var(--short)">
        stop armed
      </text>
    </svg>
  );
}

/** Two stamps slamming in. */
export function StepVisualSettle() {
  return (
    <svg viewBox="0 0 220 130" role="img" aria-label="HIT and STOPPED stamps" className="vis">
      <g className="slam" style={{ transformOrigin: "62px 58px", "--d": "0.1s" } as React.CSSProperties}>
        <g transform="rotate(-10 62 58)">
          <rect x="22" y="38" width="80" height="40" rx="5" fill="none" stroke="var(--long)" strokeWidth="4" />
          <text x="62" y="66" textAnchor="middle" fontSize="24" fontWeight="800" fill="var(--long)" letterSpacing="3">
            HIT
          </text>
        </g>
      </g>
      <g className="slam" style={{ transformOrigin: "150px 92px", "--d": "0.35s" } as React.CSSProperties}>
        <g transform="rotate(7 150 92)">
          <rect x="102" y="74" width="100" height="40" rx="5" fill="none" stroke="var(--short)" strokeWidth="4" />
          <text x="152" y="102" textAnchor="middle" fontSize="19" fontWeight="800" fill="var(--short)" letterSpacing="2">
            STOPPED
          </text>
        </g>
      </g>
    </svg>
  );
}
