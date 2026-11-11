"use client";
import { useEffect, useRef } from "react";
import Link from "next/link";
import ShareButtons from "./ShareButtons";

/** A focus-trapped dialog. Esc and the close button dismiss it. Focus returns to whatever opened it. */
export default function ShareModal({
  title,
  intro,
  text,
  url,
  cardHref,
  onClose,
  children,
}: {
  title: string;
  intro?: string;
  text: string;
  url: string;
  cardHref?: string;
  onClose: () => void;
  children?: React.ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

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
      const f = [...box.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')];
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

  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" ref={box}>
        <div className="modal-head">
          <h2 id="modal-title">{title}</h2>
          <button ref={closeRef} type="button" className="toast-x" aria-label="Close" onClick={onClose}>
            &times;
          </button>
        </div>
        {intro && <p className="hint" style={{ marginBottom: 12 }}>{intro}</p>}
        <div className="modal-ticket">{children}</div>
        <ShareButtons
          primary
          text={text}
          url={url}
          extra={
            cardHref ? (
              <Link className="btn" href={cardHref}>
                Open card
              </Link>
            ) : null
          }
        />
      </div>
    </div>
  );
}
