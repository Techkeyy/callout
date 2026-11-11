"use client";
import { useEffect, useRef, useState } from "react";
import { xIntentUrl } from "@/lib/share";

/** Share on X plus copy link. `url` is absolute. */
export default function ShareButtons({ text, url, primary = false, extra }: { text: string; url: string; primary?: boolean; extra?: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  async function copy() {
    setFailed(false);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2200);
    } catch {
      setFailed(true);
    }
  }

  return (
    <div className="actions">
      <a className={`btn ${primary ? "btn-primary" : ""}`} href={xIntentUrl(text, url)} target="_blank" rel="noopener noreferrer">
        Share on X
      </a>
      <button type="button" className="btn" onClick={copy}>
        {copied ? "Copied" : "Copy link"}
      </button>
      {extra}
      <span className="sr" role="status">
        {copied ? "Link copied" : failed ? "Could not copy the link" : ""}
      </span>
      {failed && <span className="hint num">{url}</span>}
    </div>
  );
}
