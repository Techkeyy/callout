import { formatDisplay } from "@/lib/prices";
import { formatCountdown, shortAddress, type CallStatus } from "@/lib/time";
import { OUTCOME_LABEL, type Outcome } from "@/lib/outcome";

interface Props {
  id?: bigint;
  market: string;
  isLong: boolean;
  entry: bigint | null;
  stop: bigint | null;
  target: bigint | null;
  dp: number;
  note: string;
  caller?: string;
  status?: CallStatus;
  secsLeft?: number;
  preview?: boolean;
  /** When set, the stamp shows the outcome (OPEN / HIT / STOPPED / EXPIRED) instead of the direction. */
  outcome?: Outcome;
  /** Bond in 18-decimal USDso. */
  bond?: bigint | null;
  /** Follower capacity and the part already covered, 18-decimal USDso. Covered is null when the take ledger could not be read. */
  capacity?: bigint | null;
  covered?: bigint | null;
  /** For an expired call: where it settled and who got what, already worded. */
  settlement?: string | null;
  /** The caller's record, already worded ("4 hit, 1 stopped, 80% hit rate"). */
  recordLine?: string | null;
}

const dash = "-";
const E18 = 10n ** 18n;
/** Whole amounts without decimals, otherwise two. */
const usd = (v: bigint) => formatDisplay(v, v % E18 === 0n ? 0 : 2);

export default function Ticket({ id, market, isLong, entry, stop, target, dp, note, caller, status, secsLeft, preview, outcome, bond, capacity, covered, settlement, recordLine }: Props) {
  const f = (v: bigint | null) => (v === null ? dash : formatDisplay(v, dp));
  const resolved = outcome !== undefined && outcome !== "open";
  const stateText = resolved
    ? outcome === "hit"
      ? "Target reached"
      : outcome === "stopped"
        ? "Stopped out"
        : "Expired"
    : status === "closed"
      ? "Closed by caller"
      : status === "expired"
        ? "Expired"
        : secsLeft !== undefined
          ? `Open, ${formatCountdown(secsLeft)} left`
          : "Draft";
  const stampClass = outcome ? `is-${outcome}` : isLong ? "is-long" : "is-short";
  const stampText = outcome ? OUTCOME_LABEL[outcome] : isLong ? "LONG" : "SHORT";
  return (
    <div className="ticket-shadow">
      <article className="ticket" aria-label={`${isLong ? "Long" : "Short"} call on ${market}${outcome ? `, ${OUTCOME_LABEL[outcome].toLowerCase()}` : ""}`}>
        <div className="ticket-head">
          <span>{preview ? "Preview" : id !== undefined ? `Call #${id.toString()}` : "Call"}</span>
          {/* The stamp already says OPEN; the pill only adds news: closed by the caller, or expired and not yet settled. */}
          {status && !resolved && status !== "open" && <span className={`status is-${status}`}>{status === "expired" ? "Expired" : "Closed"}</span>}
        </div>
        <div className="ticket-body">
          <span className={`stamp ${stampClass}`}>{stampText}</span>
          <h2 className="ticket-market">{market}</h2>
          <p className={`dir-chip ${isLong ? "is-long" : "is-short"}`}>{isLong ? "Long" : "Short"}</p>
          <div className="prices num">
            <div>
              <p className="price-k">Entry</p>
              <p className="price-v">{f(entry)}</p>
            </div>
            <div>
              <p className="price-k">Stop</p>
              <p className="price-v is-short">{f(stop)}</p>
            </div>
            <div>
              <p className="price-k">Target</p>
              <p className="price-v is-long">{f(target)}</p>
            </div>
          </div>
          <p className={`ticket-note ${note ? "" : "is-empty"}`}>{note || "No note yet."}</p>
          {capacity !== undefined && capacity !== null && (
            <p className="ticket-cap num">
              {usd(capacity)} USDso capacity{covered !== undefined && covered !== null ? ` · ${usd(covered)} covered` : ""}
            </p>
          )}
          {settlement && <p className="ticket-settle">{settlement}</p>}
        </div>
        <div className="ticket-stub">
          <div>
            <p className="stub-k">Caller</p>
            <p className="stub-v num">{caller ? shortAddress(caller) : "You"}</p>
            {recordLine && <p className="stub-record">{recordLine}</p>}
          </div>
          <div style={{ textAlign: "right" }}>
            <p className="stub-k">{bond !== undefined && bond !== null ? `Bond ${formatDisplay(bond, bond % (10n ** 18n) === 0n ? 0 : 2)} USDso` : "Status"}</p>
            <p className="stub-v">{stateText}</p>
          </div>
        </div>
      </article>
    </div>
  );
}
