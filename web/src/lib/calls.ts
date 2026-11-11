import { createPublicClient, http } from "viem";
import { callBookAbi, getCallBookAddress, type Call } from "./callbook";
import { HTTP_URL, somniaTokyo } from "./chain";
import { classifyReadError, READ_BACKOFF_MS, READ_RETRIES, READ_TIMEOUT_MS, UNREACHABLE_COPY } from "./readstate";
import { hedge, withRetry, withTimeout } from "./take";
import { outcomeFromCode, type Outcome, type RecordCounts } from "./outcome";

export const publicClient = createPublicClient({
  chain: somniaTokyo,
  transport: http(HTTP_URL),
});

export interface ReadOpts {
  retries?: number;
  timeoutMs?: number;
}

/** A read with a timeout and a short backoff between retries. */
function robust<T>(fn: () => Promise<T>, o?: ReadOpts): Promise<T> {
  const timeout = o?.timeoutMs ?? READ_TIMEOUT_MS;
  // A hung RPC call is the common failure: after 2s start a second copy in parallel, and a third after 4s. First success wins.
  return withRetry(() => withTimeout(hedge(fn, [2000, 4000]), timeout), o?.retries ?? READ_RETRIES, READ_BACKOFF_MS);
}

export type CallResult =
  | { status: "ok"; call: Call }
  | { status: "missing" }
  /** No contract address is configured. */
  | { status: "unavailable" }
  /** The read failed: network, RPC or timeout. Not the same as missing. */
  | { status: "error"; message: string };

/** Read one call. Works on server and client. */
export async function readCall(id: bigint, o?: ReadOpts): Promise<CallResult> {
  const address = getCallBookAddress();
  if (!address) return { status: "unavailable" };
  try {
    if (id < 1n) return { status: "missing" };
    // An unknown id reverts NoSuchCall. That is an answer, not a failure, so it must not be retried.
    const call = (await robust(async () => {
      try {
        return await publicClient.readContract({ address, abi: callBookAbi, functionName: "getCall", args: [id] });
      } catch (e) {
        if (classifyReadError(e) === "missing") return null;
        throw e;
      }
    }, o)) as Call | null;
    if (call === null) return { status: "missing" };
    return { status: "ok", call };
  } catch (e) {
    return classifyReadError(e) === "missing" ? { status: "missing" } : { status: "error", message: UNREACHABLE_COPY };
  }
}

export function parseCallId(raw: string): bigint | null {
  return /^\d{1,18}$/.test(raw) && BigInt(raw) > 0n ? BigInt(raw) : null;
}

export interface TakeStats {
  fills: number;
  takers: number;
  fees: bigint;
}

/** Take counts for a call. Null when the contract is not set or the read failed. */
export async function readTakes(id: bigint, o?: ReadOpts): Promise<TakeStats | null> {
  const address = getCallBookAddress();
  if (!address) return null;
  try {
    const t = (await robust(() => publicClient.readContract({ address, abi: callBookAbi, functionName: "getTakes", args: [id] }), o)) as {
      fills: number;
      takers: number;
      fees: bigint;
    };
    return { fills: Number(t.fills), takers: Number(t.takers), fees: t.fees };
  } catch {
    return null;
  }
}

export type CallsOfResult =
  | { status: "ok"; ids: bigint[] }
  | { status: "unavailable" }
  | { status: "error"; message: string };

/** All call ids for a caller, newest first. Distinguishes not configured from a failed read. */
export async function readCallsOf(caller: `0x${string}`, o?: ReadOpts): Promise<CallsOfResult> {
  const address = getCallBookAddress();
  if (!address) return { status: "unavailable" };
  try {
    const ids = (await robust(() => publicClient.readContract({ address, abi: callBookAbi, functionName: "callsOf", args: [caller] }), o)) as readonly bigint[];
    return { status: "ok", ids: [...ids].reverse() };
  } catch {
    return { status: "error", message: UNREACHABLE_COPY };
  }
}

export interface ResultData {
  outcome: Outcome;
  resolvedAt: bigint;
  price: bigint;
  bond: bigint;
  claimedTotal: bigint;
}

/** The on-chain result of a call: outcome, bond and what has been claimed. Null when unreadable or the contract is not set. */
export async function readResult(id: bigint, o?: ReadOpts): Promise<ResultData | null> {
  const address = getCallBookAddress();
  if (!address) return null;
  try {
    const r = (await robust(() => publicClient.readContract({ address, abi: callBookAbi, functionName: "getResult", args: [id] }), o)) as {
      outcome: number;
      resolvedAt: bigint;
      price: bigint;
      bond: bigint;
      claimedTotal: bigint;
    };
    return { outcome: outcomeFromCode(r.outcome), resolvedAt: BigInt(r.resolvedAt), price: BigInt(r.price), bond: BigInt(r.bond), claimedTotal: BigInt(r.claimedTotal) };
  } catch {
    return null;
  }
}

/** A caller's hits, stops and expired counts. */
export async function readRecord(caller: `0x${string}`, o?: ReadOpts): Promise<RecordCounts | null> {
  const address = getCallBookAddress();
  if (!address) return null;
  try {
    const r = (await robust(() => publicClient.readContract({ address, abi: callBookAbi, functionName: "getRecord", args: [caller] }), o)) as {
      hits: number;
      stops: number;
      expired: number;
    };
    return { hits: Number(r.hits), stops: Number(r.stops), expired: Number(r.expired) };
  } catch {
    return null;
  }
}

/** The minimum bond in 18-decimal USDso, or null when unreadable. */
export async function readMinBond(o?: ReadOpts): Promise<bigint | null> {
  const address = getCallBookAddress();
  if (!address) return null;
  try {
    return BigInt((await robust(() => publicClient.readContract({ address, abi: callBookAbi, functionName: "minBond" }), o)) as bigint);
  } catch {
    return null;
  }
}

/** What a wallet could claim on a call right now, or null when unreadable. */
export async function readClaimable(id: bigint, who: `0x${string}`, o?: ReadOpts): Promise<bigint | null> {
  const address = getCallBookAddress();
  if (!address) return null;
  try {
    return BigInt((await robust(() => publicClient.readContract({ address, abi: callBookAbi, functionName: "claimableOf", args: [id, who] }), o)) as bigint);
  } catch {
    return null;
  }
}

/** The number of calls ever posted, or null when unreadable or the contract is not set. */
export async function readCallCount(o?: ReadOpts): Promise<bigint | null> {
  const address = getCallBookAddress();
  if (!address) return null;
  try {
    return BigInt((await robust(() => publicClient.readContract({ address, abi: callBookAbi, functionName: "callCount" }), o)) as bigint);
  } catch {
    return null;
  }
}
