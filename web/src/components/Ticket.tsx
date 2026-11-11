import { formatDisplay } from "@/lib/prices";
import { formatCountdown, shortAddress, type CallStatus } from "@/lib/time";

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
}

const dash = "-";

export default function Ticket({ id, market, isLong, entry, stop, target, dp, note, caller, status, secsLeft, preview }: Props) {
  const f = (v: bigint | null) => (v === null ? dash : formatDisplay(v, dp));
  const stateText =
    status === "closed"
      ? "Closed by caller"
      : status === "expired"
        ? "Expired"
        : secsLeft !== undefined
          ? `Open, ${formatCountdown(secsLeft)} left`
          : "Draft";
  return (
    <div className="ticket-shadow">
      <article className="ticket" aria-label={`${isLong ? "Long" : "Short"} call on ${market}`}>
        <div className="ticket-head">
          <span>{preview ? "Preview" : id !== undefined ? `Call #${id.toString()}` : "Call"}</span>
          {status && <span className={`status is-${status}`}>{status === "open" ? "Open" : status === "expired" ? "Expired" : "Closed"}</span>}
        </div>
        <div className="ticket-body">
          <span className={`stamp ${isLong ? "is-long" : "is-short"}`}>{isLong ? "LONG" : "SHORT"}</span>
          <h2 className="ticket-market">{market}</h2>
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
        </div>
        <div className="ticket-stub">
          <div>
            <p className="stub-k">Caller</p>
            <p className="stub-v num">{caller ? shortAddress(caller) : "You"}</p>
          </div>
          <div style={{ textAlign: "right" }}>
            <p className="stub-k">Status</p>
            <p className="stub-v">{stateText}</p>
          </div>
        </div>
      </article>
    </div>
  );
}
