import { readCall, readCallCount, readRecord, readTakes } from "./calls";
import type { BoardRow } from "./outcome";

const CAP = 300;
const TTL_MS = 30_000;
const CONCURRENCY = 12;

export interface Board {
  rows: BoardRow[];
  /** True when some reads failed, so the numbers may be low. Never shown as complete. */
  partial: boolean;
  /** Calls scanned for takers and fees (the newest CAP). */
  scanned: number;
  total: number;
  /** False when the contract address is not set. */
  configured: boolean;
  /** True when the call count itself could not be read. */
  unreachable: boolean;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

async function build(): Promise<Board> {
  const count = await readCallCount({ retries: 1, timeoutMs: 8000 });
  if (count === null) {
    return { rows: [], partial: true, scanned: 0, total: 0, configured: true, unreachable: true };
  }
  const total = Number(count);
  const first = Math.max(1, total - CAP + 1);
  const ids: bigint[] = [];
  for (let i = total; i >= first; i--) ids.push(BigInt(i));

  const opts = { retries: 1, timeoutMs: 8000 };
  const per = await mapLimit(ids, CONCURRENCY, async (id) => {
    const [c, t] = await Promise.all([readCall(id, opts), readTakes(id, opts)]);
    return { c, t };
  });

  let partial = false;
  const agg = new Map<string, { takers: number; fees: bigint }>();
  for (const { c, t } of per) {
    if (c.status !== "ok" || t === null) {
      partial = true;
      continue;
    }
    const k = c.call.caller.toLowerCase();
    const a = agg.get(k) ?? { takers: 0, fees: 0n };
    a.takers += t.takers;
    a.fees += t.fees;
    agg.set(k, a);
  }
  const callers = [...agg.keys()];
  const records = await mapLimit(callers, CONCURRENCY, (a) => readRecord(a as `0x${string}`, opts));
  const rows: BoardRow[] = [];
  callers.forEach((caller, i) => {
    const rec = records[i];
    if (!rec) {
      partial = true;
      return;
    }
    const a = agg.get(caller)!;
    rows.push({ caller, hits: rec.hits, stops: rec.stops, expired: rec.expired, takers: a.takers, fees: a.fees });
  });
  return { rows, partial, scanned: ids.length, total, configured: true, unreachable: false };
}

let cache: { at: number; board: Board } | null = null;
let inflight: Promise<Board> | null = null;

/** The leaderboard source data, cached for 30 seconds with one in-flight build. A partial build is cached only briefly. */
export async function loadBoard(): Promise<Board> {
  if (!process.env.NEXT_PUBLIC_CALLBOOK_ADDRESS) {
    return { rows: [], partial: false, scanned: 0, total: 0, configured: false, unreachable: false };
  }
  if (cache && Date.now() - cache.at < (cache.board.partial ? 5_000 : TTL_MS)) return cache.board;
  if (!inflight) {
    inflight = build()
      .then((b) => {
        cache = { at: Date.now(), board: b };
        return b;
      })
      .finally(() => {
        inflight = null;
      });
  }
  return inflight;
}
