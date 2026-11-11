import { describe, expect, it } from "vitest";
import { applyLive, snapToBar, lastTradeAgeSec, levelStats, mapCandles, scaleRaw, staleLabel } from "./chart";

const E = (n: string) => n + "0".repeat(18);

describe("chart data", () => {
  it("scales raw 18-decimal strings", () => {
    expect(scaleRaw(E("73741"))).toBe(73741);
    expect(scaleRaw("1500000000000000000")).toBe(1.5);
    expect(scaleRaw("12")).toBeCloseTo(1.2e-17);
    expect(scaleRaw("abc")).toBeNull();
  });
  it("maps, sorts, dedupes and drops bad rows", () => {
    const row = (t: string, o: string, h: string, l: string, c: string) => ({ bucketStart: t, openPrice: E(o), high: E(h), low: E(l), closePrice: E(c) });
    const out = mapCandles([row("200", "10", "12", "9", "11"), row("100", "8", "9", "7", "8"), row("200", "10", "13", "9", "12"), { bucketStart: "300", openPrice: "x", high: "1", low: "1", closePrice: "1" }]);
    expect(out.map((c) => c.time)).toEqual([100, 200]);
    expect(out[1]).toEqual({ time: 200, open: 10, high: 13, low: 9, close: 12 });
  });
  it("updates the current bucket with the live mark", () => {
    const c = [{ time: 120, open: 10, high: 11, low: 9, close: 10 }];
    const out = applyLive(c, 12, 150, 60);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ time: 120, open: 10, high: 12, low: 9, close: 12 });
    expect(c[0].close).toBe(10);
  });
  it("opens a new bucket when the last candle is old", () => {
    const out = applyLive([{ time: 0, open: 10, high: 11, low: 9, close: 10.5 }], 9.5, 7300, 3600);
    expect(out).toHaveLength(2);
    expect(out[1]).toEqual({ time: 7200, open: 10.5, high: 10.5, low: 9.5, close: 9.5 });
  });
  it("ignores a missing mark and starts from nothing", () => {
    expect(applyLive([], null, 100, 60)).toEqual([]);
    expect(applyLive([], 5, 100, 60)).toEqual([{ time: 60, open: 5, high: 5, low: 5, close: 5 }]);
  });
  it("words staleness", () => {
    expect(lastTradeAgeSec([], 100, 60)).toBeNull();
    const age = lastTradeAgeSec([{ time: 0, open: 1, high: 1, low: 1, close: 1 }], 3 * 3600 + 3600, 3600);
    expect(age).toBe(3 * 3600);
    expect(staleLabel(age, 3600)).toBe("Last trade 3h ago");
    expect(staleLabel(30, 60)).toBeNull();
    expect(staleLabel(600, 60)).toBe("Last trade 10m ago");
  });
  it("computes distances and reward to risk", () => {
    const s = levelStats({ isLong: true, entry: 100, stop: 98, target: 106, ref: 101 });
    expect(s.rewardRisk).toBe(3);
    expect(s.toStopPct).toBeCloseTo(((101 - 98) / 101) * 100);
    expect(s.toTargetPct).toBeCloseTo(((106 - 101) / 101) * 100);
    const sh = levelStats({ isLong: false, entry: 100, stop: 102, target: 96, ref: null });
    expect(sh.rewardRisk).toBe(2);
    expect(sh.toStopPct).toBe(2);
    expect(sh.toTargetPct).toBe(4);
    expect(levelStats({ isLong: true, entry: 100, stop: 101, target: 106, ref: null }).rewardRisk).toBeNull();
  });
  it("snaps a time to the bar that contains it", () => {
    expect(snapToBar([0, 60, 120], 130, 60)).toBe(120);
    expect(snapToBar([0, 60, 120], 59, 60)).toBe(0);
    expect(snapToBar([60, 120], 10, 60)).toBeNull();
    expect(snapToBar([0, 60], 500, 60)).toBeNull();
  });
});
