// Renders a CardModel as a 1200x630 PNG with next/og. Never throws: any failure falls back to the plain brand card.
import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadOgFonts, type OgFont } from "@/app/fonts/load";
import { fallbackModel, type CardModel, type Tone } from "./cardmodel";

export const OG_SIZE = { width: 1200, height: 630 };

const INK = "#141414";
const PAPER = "#F4F1EA";
const SLIP = "#FBF9F4";
const SIGNAL = "#FF4D1C";
const LONG = "#1B7A3E";
const SHORT = "#C0281D";
const GREY = "#6B665D";
const BAND = "#AAAAAA";

const color = (t: Tone | undefined) => (t === "long" ? LONG : t === "short" ? SHORT : t === "signal" ? SIGNAL : INK);

let artCache: string | null | undefined;
/** The megaphone sticker as a data URI. Null when the file cannot be read. */
async function megaphone(): Promise<string | null> {
  if (artCache !== undefined) return artCache;
  try {
    const buf = await readFile(path.join(process.cwd(), "public", "hero-megaphone.jpg"));
    artCache = `data:image/jpeg;base64,${buf.toString("base64")}`;
  } catch {
    artCache = null;
  }
  return artCache;
}

function Card({ m, ui, mono, art }: { m: CardModel; ui: string; mono: string; art: string | null }) {
  const hl = m.headline.length;
  const hSize = m.kind === "call" ? (hl <= 10 ? 104 : 84) : hl <= 14 ? 84 : hl <= 20 ? 70 : 58;
  const hasBig = !!m.big;
  const cellSize = m.cells.length >= 5 ? 32 : hasBig ? 38 : 46;
  const cellLabel = m.cells.length >= 5 ? 20 : 24;
  const stampColor = color(m.tone);
  const hasMain = m.cells.length > 0 || hasBig;

  return (
    <div style={{ width: "100%", height: "100%", display: "flex", background: PAPER, padding: 36, fontFamily: ui }}>
      <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column", background: SLIP, border: `4px solid ${INK}`, borderRadius: 28, overflow: "hidden" }}>
        <div style={{ position: "absolute", left: -26, top: 432, width: 52, height: 52, borderRadius: 26, background: PAPER, border: `4px solid ${INK}`, display: "flex" }} />
        <div style={{ position: "absolute", right: -26, top: 432, width: 52, height: 52, borderRadius: 26, background: PAPER, border: `4px solid ${INK}`, display: "flex" }} />

        <div style={{ display: "flex", flex: 1 }}>
          {/* left: the call */}
          <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: "26px 40px 0 44px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <svg width="40" height="40" viewBox="0 0 22 22">
                <rect x="1" y="3" width="20" height="16" rx="3" fill={SIGNAL} stroke={INK} strokeWidth="1.6" />
                <path d="M14 3v16" stroke={INK} strokeWidth="1.6" strokeDasharray="2.5 2" />
              </svg>
              <div style={{ display: "flex", fontSize: 36, fontWeight: 800, color: INK, letterSpacing: -1 }}>Callout</div>
              <div style={{ display: "flex", fontSize: 26, color: GREY, fontWeight: 600, marginLeft: 6 }}>{m.eyebrow}</div>
            </div>

            <div style={{ display: "flex", fontSize: hSize, fontWeight: 800, color: INK, letterSpacing: -3, lineHeight: 1, marginTop: 16 }}>{m.headline}</div>
            {m.sub && <div style={{ display: "flex", fontSize: 36, fontWeight: 800, color: color(m.subTone), letterSpacing: 3, marginTop: 8 }}>{m.sub}</div>}

            {hasBig && m.big && (
              <div style={{ display: "flex", alignItems: "center", gap: 28, marginTop: 14 }}>
                <div style={{ display: "flex", fontSize: 112, fontWeight: 700, color: color(m.big.tone), fontFamily: mono, letterSpacing: -4, lineHeight: 1 }}>{m.big.v}</div>
                <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
                  <div style={{ display: "flex", fontSize: 26, fontWeight: 600, color: GREY }}>{m.big.k}</div>
                  {m.big.note && <div style={{ display: "flex", fontSize: 30, fontWeight: 800, color: INK, marginTop: 4, lineHeight: 1.1 }}>{m.big.note}</div>}
                </div>
              </div>
            )}

            {hasMain && m.cells.length > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: "auto", marginBottom: 22, paddingTop: 16, borderTop: `3px dashed ${INK}` }}>
                {m.cells.map((c) => (
                  <div key={c.k} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <div style={{ display: "flex", fontSize: cellLabel, color: GREY, fontWeight: 600 }}>{c.k}</div>
                    <div style={{ display: "flex", fontSize: cellSize, color: color(c.tone), fontFamily: mono, fontWeight: 700 }}>{c.v}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* right: grey art band with the stamp */}
          <div style={{ position: "relative", display: "flex", width: 300, background: BAND, borderLeft: `4px dashed ${INK}`, overflow: "hidden" }}>
            {art && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={art} width={360} height={391} alt="" style={{ position: "absolute", left: -36, top: 96, transform: "rotate(-5deg)" }} />
            )}
          </div>
          <div
            style={{
              position: "absolute",
              right: 26,
              top: 30,
              display: "flex",
              fontSize: m.stamp.length > 7 ? 44 : 52,
              fontWeight: 800,
              color: stampColor,
              border: `7px solid ${stampColor}`,
              borderRadius: 14,
              padding: "2px 22px",
              letterSpacing: 7,
              transform: "rotate(-8deg)",
              background: "rgba(251,249,244,0.92)",
            }}
          >
            {m.stamp}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 102, padding: "0 44px", borderTop: `4px dashed ${INK}` }}>
          <div style={{ display: "flex", flexDirection: "column", width: 330 }}>
            <div style={{ display: "flex", fontSize: 22, color: GREY, fontWeight: 600 }}>{m.footL.k}</div>
            <div style={{ display: "flex", fontSize: 30, color: INK, fontFamily: mono, fontWeight: 700 }}>{m.footL.v}</div>
            {m.footL.v2 && <div style={{ display: "flex", fontSize: 18, color: GREY, fontWeight: 600 }}>{m.footL.v2.length > 44 ? `${m.footL.v2.slice(0, 43)}...` : m.footL.v2}</div>}
          </div>
          <div style={{ display: "flex", fontSize: 26, color: INK, fontWeight: 800 }}>Call it. Back it. Prove it.</div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", width: 330 }}>
            <div style={{ display: "flex", fontSize: 22, color: GREY, fontWeight: 600 }}>{m.footR.k}</div>
            <div style={{ display: "flex", fontSize: 30, color: INK, fontFamily: mono, fontWeight: 700 }}>{m.footR.v}</div>
            {m.footR.v2 && <div style={{ display: "flex", fontSize: 18, color: GREY, fontWeight: 600 }}>{m.footR.v2}</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

/** A PNG response for a model (null means use the generic card). Always returns an image. */
export async function renderCard(model: CardModel | null): Promise<Response> {
  let fonts: OgFont[] = [];
  try {
    fonts = await loadOgFonts();
  } catch {
    /* default font */
  }
  const art = await megaphone();
  const ui = fonts.length ? "Bricolage" : "sans-serif";
  const mono = fonts.length ? "JetBrains Mono" : "monospace";
  const draw = (m: CardModel, a: string | null, f: OgFont[]) => new ImageResponse(<Card m={m} ui={ui} mono={mono} art={a} />, { ...OG_SIZE, fonts: f.length ? f : undefined });
  try {
    const res = draw(model ?? fallbackModel(), art, fonts);
    // ImageResponse renders lazily; touching the body surfaces a layout error here, where it can still be caught.
    const buf = await res.arrayBuffer();
    return new Response(buf, { headers: { "content-type": "image/png", "cache-control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300" } });
  } catch {
    try {
      const res = draw(fallbackModel(), null, []);
      return new Response(await res.arrayBuffer(), { headers: { "content-type": "image/png", "cache-control": "no-store" } });
    } catch {
      // A 1x1 transparent PNG, so a link preview never gets a 500.
      const px = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
      return new Response(px, { headers: { "content-type": "image/png", "cache-control": "no-store" } });
    }
  }
}
