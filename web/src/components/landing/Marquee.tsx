"use client";
import Link from "next/link";
import { OUTCOME_LABEL } from "@/lib/outcome";
import { formatDisplay } from "@/lib/prices";
import { useRecent, type RecentItem } from "./useRecent";
import { useChainNow } from "@/lib/chainclock";

function label(i: RecentItem, nowSec: number): string {
  if (i.outcome !== "open") return OUTCOME_LABEL[i.outcome];
  if (i.call.closedAt > 0n) return "CLOSED";
  return Number(i.call.expiresAt) <= nowSec ? "EXPIRED" : "OPEN";
}

/** The strip along the bottom of the hero: real recent calls, read from the chain. */
export default function Marquee() {
  const { data, retry } = useRecent();
  const now = useChainNow(5000);

  let body: React.ReactNode;
  if (data.state === "loading") {
    body = <p className="mq-msg">Reading the latest calls from the chain...</p>;
  } else if (data.state === "failed") {
    body = (
      <p className="mq-msg">
        Could not read recent calls right now.{" "}
        <button type="button" className="mq-link" onClick={retry}>
          Try again
        </button>
      </p>
    );
  } else if (data.state === "unavailable") {
    body = <p className="mq-msg">Calls are not live yet.</p>;
  } else if (data.state === "empty") {
    body = (
      <p className="mq-msg">
        No calls yet.{" "}
        <Link className="mq-link" href="/app">
          Post the first one
        </Link>
      </p>
    );
  } else {
    const row = (hidden: boolean) =>
      data.items.map((i) => (
        <li key={(hidden ? "b" : "a") + i.id.toString()}>
          <Link href={"/c/" + i.id} tabIndex={hidden ? -1 : undefined} className="mq-item">
            <span>{i.call.isLong ? "Long" : "Short"}</span> <span>{i.name}</span>
            <span className="mq-dot" aria-hidden="true">
              {" · "}
            </span>
            <span className="num">{formatDisplay(i.call.entry, i.dp)}</span>
            <span className="mq-dot" aria-hidden="true">
              {" · "}
            </span>
            <span className="mq-state">{label(i, now)}</span>
          </Link>
        </li>
      ));
    body = (
      <div className="mq-scroll">
        <ul className="mq-track" aria-label="Recent calls">
          {row(false)}
        </ul>
        <ul className="mq-track" aria-hidden="true">
          {row(true)}
        </ul>
      </div>
    );
  }
  return (
    <div className="mq" aria-label="Live calls from the chain">
      <span className="mq-tag">
        <span className="live-dot" aria-hidden="true" /> Live
      </span>
      {body}
    </div>
  );
}
