import { ImageResponse } from "next/og";
import { loadOgFonts } from "./fonts/load";

export const alt = "Callout. Call it. Back it. Prove it.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#141414";
const SIGNAL = "#FF4D1C";

export default async function OgImage() {
  const fonts = await loadOgFonts();
  const ui = fonts.length ? "Bricolage" : "sans-serif";
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#AAAAAA", padding: 64, fontFamily: ui, color: INK }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <svg width="52" height="52" viewBox="0 0 22 22">
            <rect x="1" y="3" width="20" height="16" rx="3" fill={SIGNAL} stroke={INK} strokeWidth="1.6" />
            <path d="M14 3v16" stroke={INK} strokeWidth="1.6" strokeDasharray="2.5 2" />
          </svg>
          <div style={{ display: "flex", fontSize: 46, fontWeight: 800, letterSpacing: -1 }}>Callout</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", fontSize: 150, fontWeight: 800, letterSpacing: -6, lineHeight: 0.95 }}>
          <div style={{ display: "flex" }}>Call it. Back it.</div>
          <div style={{ display: "flex", marginTop: 10 }}>
            <div style={{ display: "flex", background: SIGNAL, border: `6px solid ${INK}`, borderRadius: 16, padding: "0 22px 8px", transform: "rotate(-2deg)" }}>Prove it.</div>
          </div>
        </div>
        <div style={{ display: "flex", fontSize: 30, fontWeight: 600 }}>Perps trade calls with a bond behind them. On chain. Somnia Tokyo testnet.</div>
      </div>
    ),
    { ...size, fonts: fonts.length ? fonts : undefined },
  );
}
