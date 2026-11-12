"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import ShareCard from "./ShareCard";
import type { CardModel } from "@/lib/cardmodel";
import { farcasterUrl, siteOrigin, siteUrl, telegramUrl, whatsappUrl, xIntentUrl } from "@/lib/share";

const FOCUSABLE = 'a[href], button:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])';

/**
 * The share sheet: the animated card, the pre-written text, and one button per destination.
 * A focus-trapped dialog. Esc and the close button dismiss it. Under 600px it is a bottom sheet.
 */
export default function ShareSheet({ title, intro, model, onClose, openHref }: { title: string; intro?: string; model: CardModel; onClose: () => void; openHref?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [text, setText] = useState(model.text);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState<"" | "download" | "share">("");
  const [canShare, setCanShare] = useState(false);
  const blob = useRef<Promise<Blob | null> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const url = useMemo(() => siteUrl(siteOrigin(), model.path), [model.path]);
  const fileName = `callout-${model.kind}-${model.fileId}.png`;

  useEffect(() => setText(model.text), [model.text]);
  useEffect(() => {
    setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function");
  }, []);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  // Start building the PNG now: it makes Download and More... quick, and warms the server render.
  function png(): Promise<Blob | null> {
    if (!blob.current) {
      blob.current = fetch(model.imagePath)
        .then((r) => (r.ok && (r.headers.get("content-type") ?? "").includes("image/png") ? r.blob() : null))
        .catch(() => null);
    }
    return blob.current;
  }
  useEffect(() => {
    void png();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.imagePath]);

  function say(s: string) {
    setStatus(s);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus(""), 2600);
  }

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !box.current) return;
      const f = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (f.length === 0) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      prev?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      say("Link copied");
    } catch {
      say(`Could not copy. The link is ${url}`);
    }
  }

  async function download() {
    setBusy("download");
    const b = await png();
    setBusy("");
    if (!b) return say("The image could not be made right now. Try again in a moment.");
    const href = URL.createObjectURL(b);
    const a = document.createElement("a");
    a.href = href;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 2000);
    say("Image saved");
  }

  async function more() {
    setBusy("share");
    try {
      const b = await png();
      if (b) {
        const file = new File([b], fileName, { type: "image/png" });
        if (navigator.canShare?.({ files: [file] })) {
          await navigator.share({ files: [file], text: `${text} ${url}` });
          return;
        }
      }
      await navigator.share({ text, url });
    } catch (e) {
      // Closing the system sheet is not an error.
      if (!(e instanceof DOMException && e.name === "AbortError")) say("Sharing did not work here. Use Copy link.");
    } finally {
      setBusy("");
    }
  }

  const link = (href: string, label: string, primary = false) => (
    <a className={`btn${primary ? " btn-primary is-wide" : ""}`} href={href} target="_blank" rel="noopener noreferrer">
      {label}
    </a>
  );

  return (
    <div className="modal-back is-sheet" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" ref={box}>
        <div className="modal-head">
          <h2 id="sheet-title">{title}</h2>
          <button ref={closeRef} type="button" className="toast-x" aria-label="Close" onClick={onClose}>
            &times;
          </button>
        </div>
        {intro && <p className="hint" style={{ margin: 0 }}>{intro}</p>}
        <ShareCard model={model} />
        <label className="sr" htmlFor="sheet-text">
          Post text
        </label>
        <textarea id="sheet-text" className="sheet-text" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
        <div className="sheet-grid">
          {link(xIntentUrl(text, url), "Share on X", true)}
          {link(telegramUrl(text, url), "Telegram")}
          {link(whatsappUrl(text, url), "WhatsApp")}
          {link(farcasterUrl(text, url), "Farcaster")}
          <button type="button" className="btn" onClick={copy}>
            Copy link
          </button>
          <button type="button" className="btn" onClick={download} disabled={busy === "download"}>
            {busy === "download" ? "Preparing..." : "Download image"}
          </button>
          {canShare && (
            <button type="button" className="btn" onClick={more} disabled={busy === "share"}>
              {busy === "share" ? "Opening..." : "More..."}
            </button>
          )}
          {openHref && (
            <Link className="btn" href={openHref}>
              Open page
            </Link>
          )}
        </div>
        <p className="sheet-status" role="status">
          {status}
        </p>
      </div>
    </div>
  );
}
