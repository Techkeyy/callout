import { ImageResponse } from "next/og";
import { parseCallId, readCall } from "@/lib/calls";
import { getMarkets } from "@/lib/markets";
import { displayDecimals, displayName, formatDisplay } from "@/lib/prices";

export const alt = "Callout trade call";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const dynamic = "force-dynamic";

export default async function OgImage({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const id = parseCallId(raw);
  const r = id ? await readCall(id, { retries: 0, timeoutMs: 6000 }) : null;
  const ok = r && r.status === "ok" ? r.call : null;
  let market = displayName("PERP");
  let dp = 2;
  if (ok) {
    const ms = await getMarkets().catch(() => []);
    const m = ms.find((x) => x.pool.toLowerCase() === ok.pool.toLowerCase());
    if (m) {
      market = m.name;
      dp = displayDecimals(BigInt(m.tickSize));
    }
  }
  const side = ok?.isLong ? "LONG" : "SHORT";
  const sideColor = ok?.isLong ? "#1b7a3e" : "#c0281d";
  const cell = (k: string, v: string, color = "#141414") => (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 28, color: "#6b665d" }}>{k}</div>
      <div style={{ fontSize: 56, fontWeight: 700, color }}>{v}</div>
    </div>
  );
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#f4f1ea", padding: 48, fontFamily: "sans-serif" }}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#fbf9f4", border: "3px solid #141414", borderRadius: 24, padding: 48 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", fontSize: 36, fontWeight: 700, color: "#141414" }}>Callout{id ? `  #${id.toString()}` : ""}</div>
            {ok && (
              <div style={{ display: "flex", fontSize: 44, fontWeight: 800, color: sideColor, border: `5px solid ${sideColor}`, borderRadius: 12, padding: "4px 24px", letterSpacing: 6 }}>{side}</div>
            )}
          </div>
          {ok ? (
            <>
              <div style={{ display: "flex", fontSize: 96, fontWeight: 800, color: "#141414", letterSpacing: -3 }}>{market}</div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                {cell("Entry", formatDisplay(ok.entry, dp))}
                {cell("Stop", formatDisplay(ok.stop, dp), "#c0281d")}
                {cell("Target", formatDisplay(ok.target, dp), "#1b7a3e")}
              </div>
              <div style={{ display: "flex", fontSize: 28, color: "#6b665d" }}>On the record. Cannot be edited.</div>
            </>
          ) : (
            <div style={{ display: "flex", fontSize: 80, fontWeight: 800, color: "#141414" }}>Post a call. Let anyone take it.</div>
          )}
        </div>
      </div>
    ),
    size,
  );
}
