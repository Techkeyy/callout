import { ImageResponse } from "next/og";
import { parseCallId, readCall, readResult } from "@/lib/calls";
import { getMarketMeta } from "@/lib/markets";
import { displayDecimals, formatDisplay } from "@/lib/prices";
import { shortAddress } from "@/lib/time";
import { OUTCOME_LABEL, type Outcome } from "@/lib/outcome";
import { loadOgFonts } from "../../fonts/load";

export const alt = "Callout trade call";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-dynamic";

const INK = "#141414";
const PAPER = "#F4F1EA";
const SLIP = "#FBF9F4";
const SIGNAL = "#FF4D1C";
const LONG = "#1B7A3E";
const SHORT = "#C0281D";
const GREY = "#6B665D";

const E18 = 10n ** 18n;
const usd = (v: bigint) => formatDisplay(v, v % E18 === 0n ? 0 : 2);

export default async function OgImage({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const id = parseCallId(raw);
  const [fonts, r] = await Promise.all([loadOgFonts(), id ? readCall(id, { retries: 0, timeoutMs: 6000 }) : Promise.resolve(null)]);
  const call = r && r.status === "ok" ? r.call : null;
  let market = "PERP";
  let dp = 2;
  let outcome: Outcome = "open";
  let bond: bigint | null = null;
  if (call && id) {
    const [m, res] = await Promise.all([getMarketMeta(call.pool, 4500), readResult(id, { retries: 0, timeoutMs: 3000 })]);
    if (m) {
      market = m.name;
      dp = displayDecimals(BigInt(m.tickSize));
    }
    if (res) {
      outcome = res.outcome;
      bond = res.bond;
    }
  }
  const ui = fonts.length ? "Bricolage" : "sans-serif";
  const mono = fonts.length ? "JetBrains Mono" : "monospace";
  const side = call?.isLong ? "LONG" : "SHORT";
  const sideColor = call?.isLong ? LONG : SHORT;
  const stampColor = outcome === "hit" ? LONG : outcome === "stopped" ? SHORT : INK;
  const stampText = OUTCOME_LABEL[outcome];

  const cell = (k: string, v: string, color = INK) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", fontSize: 26, color: GREY, fontFamily: ui, fontWeight: 600 }}>{k}</div>
      <div style={{ display: "flex", fontSize: 58, color, fontFamily: mono, fontWeight: 700 }}>{v}</div>
    </div>
  );

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: PAPER, padding: 36, fontFamily: ui }}>
        <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column", background: SLIP, border: `4px solid ${INK}`, borderRadius: 28, overflow: "hidden" }}>
          {/* tear-line notches */}
          <div style={{ position: "absolute", left: -26, top: 430, width: 52, height: 52, borderRadius: 26, background: PAPER, border: `4px solid ${INK}`, display: "flex" }} />
          <div style={{ position: "absolute", right: -26, top: 430, width: 52, height: 52, borderRadius: 26, background: PAPER, border: `4px solid ${INK}`, display: "flex" }} />

          <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: "30px 48px 0 48px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <svg width="44" height="44" viewBox="0 0 22 22">
                  <rect x="1" y="3" width="20" height="16" rx="3" fill={SIGNAL} stroke={INK} strokeWidth="1.6" />
                  <path d="M14 3v16" stroke={INK} strokeWidth="1.6" strokeDasharray="2.5 2" />
                </svg>
                <div style={{ display: "flex", fontSize: 40, fontWeight: 800, color: INK, letterSpacing: -1 }}>Callout</div>
                <div style={{ display: "flex", fontSize: 28, color: GREY, fontWeight: 600, marginLeft: 8 }}>{id ? `Call #${id.toString()}` : ""}</div>
              </div>
              {call && (
                <div
                  style={{
                    display: "flex",
                    fontSize: 54,
                    fontWeight: 800,
                    color: stampColor,
                    border: `7px solid ${stampColor}`,
                    borderRadius: 14,
                    padding: "2px 26px",
                    letterSpacing: 8,
                    transform: "rotate(-8deg)",
                    opacity: 0.92,
                    marginRight: 6,
                  }}
                >
                  {stampText}
                </div>
              )}
            </div>

            {call ? (
              <div style={{ display: "flex", flexDirection: "column" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 24, marginTop: 14 }}>
                  <div style={{ display: "flex", fontSize: 104, fontWeight: 800, color: INK, letterSpacing: -4, lineHeight: 1 }}>{market}</div>
                  <div style={{ display: "flex", fontSize: 40, fontWeight: 800, color: sideColor, letterSpacing: 5 }}>{side}</div>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 34, paddingTop: 24, borderTop: `3px dashed ${INK}`, opacity: 1 }}>
                  {cell("Entry", formatDisplay(call.entry, dp))}
                  {cell("Stop", formatDisplay(call.stop, dp), SHORT)}
                  {cell("Target", formatDisplay(call.target, dp), LONG)}
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", flex: 1, alignItems: "center", fontSize: 92, fontWeight: 800, color: INK, letterSpacing: -3, lineHeight: 1 }}>Post a call. Back it with a bond.</div>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 112, padding: "0 48px", borderTop: `4px dashed ${INK}` }}>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", fontSize: 24, color: GREY, fontWeight: 600 }}>Caller</div>
              <div style={{ display: "flex", fontSize: 32, color: INK, fontFamily: mono, fontWeight: 700 }}>{call ? shortAddress(call.caller) : "-"}</div>
            </div>
            <div style={{ display: "flex", fontSize: 30, color: INK, fontWeight: 800 }}>Call it. Back it. Prove it.</div>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
              <div style={{ display: "flex", fontSize: 24, color: GREY, fontWeight: 600 }}>Bond</div>
              <div style={{ display: "flex", fontSize: 32, color: INK, fontFamily: mono, fontWeight: 700 }}>{bond !== null ? `${usd(bond)} USDso` : "On chain"}</div>
            </div>
          </div>
        </div>
      </div>
    ),
    { ...size, fonts: fonts.length ? fonts : undefined },
  );
}
