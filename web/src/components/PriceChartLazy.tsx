"use client";
import dynamic from "next/dynamic";
import type { ChartProps } from "./PriceChart";

// The chart library and component load only in the browser, after first paint.
const PriceChart = dynamic(() => import("./PriceChart"), {
  ssr: false,
  loading: () => <div className="chart-card"><div className="skeleton" style={{ height: 48 }} aria-label="Loading chart" /></div>,
});

export default function PriceChartLazy(p: ChartProps) {
  return <PriceChart {...p} />;
}
