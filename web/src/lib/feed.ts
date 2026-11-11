import { mapLimit, newestIds, readCall, readCallCount, readRecord, readResult, readTakes } from "./calls";
import type { Call } from "./callbook";
import { remainingCapacity } from "./rules";
import type { Outcome, RecordCounts } from "./outcome";

export const FEED_SCAN = 100;

/** A call is open to take while it is not closed, not expired and not settled. */
export function isOpenCall(c: { expiresAt: bigint; closedAt: bigint }, outcome: Outcome, nowSec: number): boolean {
  return c.closedAt === 0n && Number(c.expiresAt) > nowSec && outcome === "open";
}

/** Soonest expiry first. Ties go to the newest call. */
export function sortBySoonestExpiry<T extends { id: bigint; call: { expiresAt: bigint } }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.call.expiresAt !== b.call.expiresAt) return a.call.expiresAt < b.call.expiresAt ? -1 : 1;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
}

export interface OpenCall {
  id: bigint;
  call: Call;
  /** 18-decimal USDso, or null when unreadable. */
  bond: bigint | null;
  /** Capacity not yet covered by takers, or null when the take ledger could not be read. */
  remaining: bigint | null;
  record: RecordCounts | null;
}

export type OpenCallsResult = { status: "ok"; rows: OpenCall[]; scanned: number; partial: boolean } | { status: "unavailable" } | { status: "error" };

/** Open calls from the newest FEED_SCAN ids, soonest expiry first. Runs in the browser. */
export async function loadOpenCalls(nowSec: number): Promise<OpenCallsResult> {
  const count = await readCallCount({ retries: 1, timeoutMs: 8000 });
  if (count === null) return { status: "error" };
  const ids = newestIds(Number(count), FEED_SCAN);
  const opts = { retries: 1, timeoutMs: 8000 };
  let partial = false;
  const calls = await mapLimit(ids, 10, async (id) => {
    const r = await readCall(id, opts);
    if (r.status === "unavailable") return "unavailable" as const;
    if (r.status === "error") partial = true;
    return r.status === "ok" ? { id, call: r.call } : null;
  });
  if (calls.some((c) => c === "unavailable")) return { status: "unavailable" };
  const live = calls.filter((c): c is { id: bigint; call: Call } => c !== null && c !== "unavailable" && c.call.closedAt === 0n && Number(c.call.expiresAt) > nowSec);
  const detailed = await mapLimit(live, 8, async (c): Promise<OpenCall | null> => {
    const [res, takes] = await Promise.all([readResult(c.id, opts), readTakes(c.id, opts)]);
    if (!res) {
      partial = true;
      return null;
    }
    if (!isOpenCall(c.call, res.outcome, nowSec)) return null;
    return { id: c.id, call: c.call, bond: res.bond, remaining: takes ? remainingCapacity(c.call.capacity, takes.covered) : null, record: null };
  });
  const open = detailed.filter((x): x is OpenCall => x !== null);
  const callers = [...new Set(open.map((o) => o.call.caller.toLowerCase()))];
  const records = await mapLimit(callers, 8, (a) => readRecord(a as `0x${string}`, opts));
  const byCaller = new Map(callers.map((a, i) => [a, records[i]]));
  for (const o of open) o.record = byCaller.get(o.call.caller.toLowerCase()) ?? null;
  return { status: "ok", rows: sortBySoonestExpiry(open), scanned: ids.length, partial };
}

export interface RecentCall {
  id: bigint;
  call: Call;
  outcome: Outcome;
  bond: bigint | null;
}

export type RecentResult = { status: "ok"; rows: RecentCall[] } | { status: "unavailable" } | { status: "error" };

/** The newest `n` calls with their outcome. Used by the landing page. */
export async function loadRecentCalls(n: number): Promise<RecentResult> {
  const count = await readCallCount({ retries: 1, timeoutMs: 8000 });
  if (count === null) return { status: "error" };
  const opts = { retries: 1, timeoutMs: 8000 };
  const rows = await mapLimit(newestIds(Number(count), n), 6, async (id): Promise<RecentCall | "unavailable" | null> => {
    const r = await readCall(id, opts);
    if (r.status === "unavailable") return "unavailable";
    if (r.status !== "ok") return null;
    const res = await readResult(id, opts);
    return { id, call: r.call, outcome: res?.outcome ?? "open", bond: res?.bond ?? null };
  });
  if (rows.includes("unavailable")) return { status: "unavailable" };
  const ok = rows.filter((x): x is RecentCall => x !== null && x !== "unavailable");
  if (ok.length === 0 && Number(count) > 0) return { status: "error" };
  return { status: "ok", rows: ok };
}
