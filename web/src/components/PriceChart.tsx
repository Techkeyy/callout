"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { IChartApi, IPriceLine, ISeriesApi, UTCTimestamp } from "lightweight-charts";
import { applyLive, CHART_INTERVALS, lastTradeAgeSec, levelStats, mapCandles, snapToBar, staleLabel, type ChartCandle } from "@/lib/chart";
import { formatPosted } from "@/lib/time";
import { OUTCOME_LABEL, type Outcome } from "@/lib/outcome";

const INK = "#141414";
const SHORT = "#C0281D";
const LONG = "#1B7A3E";
const SIGNAL = "#FF4D1C";
const GREY = "#6B665D";

export interface ChartProps {
  pool: string;
  isLong: boolean;
  entry: number | null;
  stop: number | null;
  target: number | null;
  /** Live mark as a plain number, or null when the feed is not usable. */
  mark: number | null;
  dp: number;
  /** Unix seconds the call was posted (call page only). */
  postedAt?: number;
  /** Where and when a settled call was recorded. */
  resolved?: { outcome: Outcome; price: number; at: number } | null;
}

type Status = "idle" | "loading" | "ready" | "failed";

function Chevron({ open }: { open: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
      <path d="M3 6l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A collapsible candle chart for one market with the call's levels drawn over it. Closed by default; nothing loads until it opens. */
export default function PriceChart(p: ChartProps) {
  const [open, setOpen] = useState(false);
  const [interval, setIntervalSecs] = useState<number>(300);
  const [candles, setCandles] = useState<ChartCandle[] | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [attempt, setAttempt] = useState(0);
  const [ready, setReady] = useState(0);
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));

  const host = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const linesRef = useRef<IPriceLine[]>([]);
  const levelsRef = useRef<number[]>([]);
  const fittedRef = useRef<string>("");

  // Fetch candles when the chart is open. The indexer is read on the server so the browser never talks to it directly.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setStatus("loading");
    fetch(`/api/candles?pool=${encodeURIComponent(p.pool)}&interval=${interval}&limit=200`, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error("bad");
        return r.json() as Promise<{ candles: Parameters<typeof mapCandles>[0] }>;
      })
      .then((j) => {
        if (!alive) return;
        setCandles(mapCandles(j.candles));
        setStatus("ready");
      })
      .catch(() => alive && setStatus("failed"));
    return () => {
      alive = false;
    };
  }, [open, p.pool, interval, attempt]);

  useEffect(() => {
    if (!open) return;
    setNowSec(Math.floor(Date.now() / 1000));
    const t = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 15_000);
    return () => clearInterval(t);
  }, [open]);

  const data = useMemo(() => (candles ? applyLive(candles, p.mark, nowSec, interval) : []), [candles, p.mark, nowSec, interval]);
  const hasCandles = !!candles && candles.length > 0;
  const stale = staleLabel(candles ? lastTradeAgeSec(candles, nowSec, interval) : null, interval);
  const drawable = open && status === "ready" && hasCandles;

  levelsRef.current = [p.entry, p.stop, p.target, p.mark, p.resolved?.price ?? null].filter((x): x is number => x !== null && Number.isFinite(x) && x > 0);

  // Create the chart when there is something to draw, and tear it down when it closes.
  useEffect(() => {
    if (!drawable || !host.current) return;
    let disposed = false;
    let chart: IChartApi | null = null;
    import("lightweight-charts").then((lw) => {
      if (disposed || !host.current) return;
      chart = lw.createChart(host.current, {
        autoSize: true,
        layout: { background: { type: lw.ColorType.Solid, color: "#FBF9F4" }, textColor: GREY, fontFamily: "var(--font-jetbrains), ui-monospace, monospace", fontSize: 12 },
        grid: { vertLines: { color: "rgba(20,20,20,0.05)" }, horzLines: { color: "rgba(20,20,20,0.07)" } },
        rightPriceScale: { borderColor: "rgba(20,20,20,0.2)", scaleMargins: { top: 0.12, bottom: 0.12 } },
        timeScale: { borderColor: "rgba(20,20,20,0.2)", timeVisible: true, secondsVisible: false, rightOffset: 4 },
        crosshair: { mode: lw.CrosshairMode.Normal },
        handleScale: { mouseWheel: false },
        handleScroll: { mouseWheel: false },
      });
      const series = chart.addCandlestickSeries({
        // Ink and paper candles: green and red are kept for long and short only.
        upColor: "#FBF9F4",
        downColor: INK,
        borderUpColor: INK,
        borderDownColor: INK,
        wickUpColor: INK,
        wickDownColor: INK,
        priceLineVisible: false,
        lastValueVisible: false,
        priceFormat: { type: "price", precision: p.dp, minMove: Math.pow(10, -p.dp) },
        autoscaleInfoProvider: (orig: () => { priceRange: { minValue: number; maxValue: number } | null; margins?: { above: number; below: number } } | null) => {
          const base = orig();
          const lv = levelsRef.current;
          if (lv.length === 0) return base;
          let min = Math.min(...lv);
          let max = Math.max(...lv);
          if (base?.priceRange) {
            min = Math.min(min, base.priceRange.minValue);
            max = Math.max(max, base.priceRange.maxValue);
          }
          return { priceRange: { minValue: min, maxValue: max }, margins: base?.margins };
        },
      });
      chartRef.current = chart;
      seriesRef.current = series;
      linesRef.current = [];
      fittedRef.current = "";
      // Push the current data and lines now that the series exists.
      setReady((r) => r + 1);
    });
    return () => {
      disposed = true;
      linesRef.current = [];
      seriesRef.current = null;
      chartRef.current = null;
      chart?.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drawable, p.dp]);
  

  // Data.
  useEffect(() => {
    const s = seriesRef.current;
    if (!s || !chartRef.current) return;
    s.setData(data.map((c) => ({ time: c.time as UTCTimestamp, open: c.open, high: c.high, low: c.low, close: c.close })));
    const key = `${p.pool}:${interval}`;
    if (fittedRef.current !== key) {
      chartRef.current.timeScale().fitContent();
      fittedRef.current = key;
    }
  }, [data, ready, p.pool, interval]);

  // Levels as price lines, rebuilt whenever a level changes (the composer edits them live).
  useEffect(() => {
    const s = seriesRef.current;
    if (!s) return;
    for (const l of linesRef.current) s.removePriceLine(l);
    linesRef.current = [];
    const add = (price: number | null, color: string, title: string, dashed = false, dotted = false) => {
      if (price === null || !Number.isFinite(price) || price <= 0) return;
      linesRef.current.push(
        s.createPriceLine({ price, color, lineWidth: 2, lineStyle: dotted ? 1 : dashed ? 2 : 0, axisLabelVisible: true, title }),
      );
    };
    add(p.entry, INK, "Entry");
    add(p.stop, SHORT, "Stop");
    add(p.target, LONG, "Target");
    add(p.mark, SIGNAL, "Live", true);
    if (p.resolved) add(p.resolved.price, p.resolved.outcome === "hit" ? LONG : p.resolved.outcome === "stopped" ? SHORT : GREY, OUTCOME_LABEL[p.resolved.outcome], false, true);
  }, [p.entry, p.stop, p.target, p.mark, p.resolved, ready]);

  // Markers for the posted time and the resolution time, only where a bar covers them.
  useEffect(() => {
    const s = seriesRef.current;
    if (!s) return;
    const times = data.map((c) => c.time);
    const m: Array<{ time: UTCTimestamp; position: "belowBar" | "aboveBar"; color: string; shape: "arrowUp" | "arrowDown"; text: string }> = [];
    const posted = p.postedAt ? snapToBar(times, p.postedAt, interval) : null;
    if (posted !== null) m.push({ time: posted as UTCTimestamp, position: "belowBar", color: INK, shape: "arrowUp", text: "Posted" });
    const done = p.resolved ? snapToBar(times, p.resolved.at, interval) : null;
    if (p.resolved && done !== null) m.push({ time: done as UTCTimestamp, position: "aboveBar", color: INK, shape: "arrowDown", text: OUTCOME_LABEL[p.resolved.outcome] });
    m.sort((a, b) => a.time - b.time);
    s.setMarkers(m);
  }, [data, p.postedAt, p.resolved, interval, ready]);

  const stats = levelStats({ isLong: p.isLong, entry: p.entry, stop: p.stop, target: p.target, ref: p.mark });
  const fromLabel = p.mark !== null ? "from the live price" : "from your entry";
  const pct = (v: number | null) => (v === null ? "-" : v <= 0 ? "Passed" : `${v.toFixed(2)}%`);
  const panelId = "chart-panel";

  return (
    <section className="chart-card" aria-label="Price chart">
      <button type="button" className="chart-toggle" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((o) => !o)}>
        <span>{open ? "Hide chart" : "Show chart"}</span>
        <Chevron open={open} />
      </button>
      {open && (
        <div id={panelId} className="chart-body">
          <div className="chart-top">
            <div className="chips" role="group" aria-label="Candle interval">
              {CHART_INTERVALS.map((i) => (
                <button type="button" key={i.secs} className="chip chip-small" aria-pressed={interval === i.secs} onClick={() => setIntervalSecs(i.secs)}>
                  {i.label}
                </button>
              ))}
            </div>
            {stale && hasCandles && <span className="hint num">{stale}</span>}
          </div>

          {status === "loading" && !hasCandles && <div className="skeleton" style={{ height: 260 }} aria-label="Loading chart" />}
          {status === "failed" && (
            <div className="chart-state" role="alert">
              <p>The chart could not load. The price feed is slow right now.</p>
              <button type="button" className="btn btn-small" onClick={() => setAttempt((n) => n + 1)}>
                Try again
              </button>
            </div>
          )}
          {status === "ready" && !hasCandles && (
            <div className="chart-state">
              <p>No trades yet on this market.</p>
              <p className="hint">Candles appear once someone trades. The levels are still shown below.</p>
            </div>
          )}
          {drawable && (
            <div ref={host} className="chart-host" role="img" aria-label={`Candle chart with entry, stop, target and live price lines${stale ? `. ${stale}` : ""}`} />
          )}

          <ul className="chart-legend" aria-label="Lines on the chart">
            <li>
              <i style={{ background: INK }} />
              Entry
            </li>
            <li>
              <i style={{ background: SHORT }} />
              Stop
            </li>
            <li>
              <i style={{ background: LONG }} />
              Target
            </li>
            <li>
              <i className="is-dashed" style={{ color: SIGNAL }} />
              Live price
            </li>
          </ul>

          <dl className="dist chart-stats" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
            <div>
              <dt className="dist-k">To stop</dt>
              <dd className="dist-v num" style={{ margin: 0 }}>
                {pct(stats.toStopPct)}
              </dd>
            </div>
            <div>
              <dt className="dist-k">To target</dt>
              <dd className="dist-v num" style={{ margin: 0 }}>
                {pct(stats.toTargetPct)}
              </dd>
            </div>
            <div>
              <dt className="dist-k">Reward to risk</dt>
              <dd className="dist-v num" style={{ margin: 0 }}>
                {stats.rewardRisk === null ? "-" : `${stats.rewardRisk.toFixed(2)} : 1`}
              </dd>
            </div>
          </dl>
          <p className="hint" style={{ marginTop: 8 }}>
            Distances are {fromLabel}.{p.postedAt ? ` Posted ${formatPosted(p.postedAt)}.` : ""}
            {p.resolved ? ` ${OUTCOME_LABEL[p.resolved.outcome]} at ${p.resolved.price.toLocaleString("en-US", { maximumFractionDigits: p.dp })}, ${formatPosted(p.resolved.at)}.` : ""}
          </p>
        </div>
      )}
    </section>
  );
}
