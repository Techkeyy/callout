"use client";
import { useState } from "react";
import ShareSheet from "./ShareSheet";
import type { CardModel } from "@/lib/cardmodel";

/**
 * A button that opens the share sheet. Pass `model` when it is known, or `modelUrl` to load it when the button is pressed
 * (the record card needs a few chain reads, so it loads on demand).
 */
export default function ShareLauncher({ label, title, intro, model, modelUrl, primary = false, openHref }: { label: string; title: string; intro?: string; model?: CardModel; modelUrl?: string; primary?: boolean; openHref?: string }) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<CardModel | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const m = model ?? loaded;

  async function press() {
    if (m) return setOpen(true);
    if (!modelUrl) return;
    setState("loading");
    try {
      const r = await fetch(modelUrl, { cache: "no-store" });
      if (!r.ok) throw new Error("bad");
      setLoaded((await r.json()) as CardModel);
      setState("idle");
      setOpen(true);
    } catch {
      setState("error");
    }
  }

  return (
    <>
      <button type="button" className={`btn${primary ? " btn-primary" : ""}`} onClick={press} disabled={state === "loading"}>
        {state === "loading" ? "Loading..." : label}
      </button>
      {state === "error" && (
        <span className="hint" role="status">
          The card is not available right now. Try again in a moment.
        </span>
      )}
      {open && m && <ShareSheet title={title} intro={intro} model={m} openHref={openHref} onClose={() => setOpen(false)} />}
    </>
  );
}
