import { createPublicClient, http } from "viem";
import { callBookAbi, getCallBookAddress, type Call } from "./callbook";
import { HTTP_URL, somniaTokyo } from "./chain";

export const publicClient = createPublicClient({
  chain: somniaTokyo,
  transport: http(HTTP_URL),
});

export type CallResult =
  | { status: "ok"; call: Call }
  | { status: "missing" }
  | { status: "unavailable" }
  | { status: "error"; message: string };

/** Read one call. Works on server and client. */
export async function readCall(id: bigint): Promise<CallResult> {
  const address = getCallBookAddress();
  if (!address) return { status: "unavailable" };
  try {
    const count = await publicClient.readContract({ address, abi: callBookAbi, functionName: "callCount" });
    if (id < 1n || id > count) return { status: "missing" };
    const call = (await publicClient.readContract({
      address,
      abi: callBookAbi,
      functionName: "getCall",
      args: [id],
    })) as Call;
    return { status: "ok", call };
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (msg.includes("NoSuchCall")) return { status: "missing" };
    return { status: "error", message: "Could not read the chain right now." };
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

/** Take counts for a call. Null when the deployed contract does not have getTakes yet. */
export async function readTakes(id: bigint): Promise<TakeStats | null> {
  const address = getCallBookAddress();
  if (!address) return null;
  try {
    const t = (await publicClient.readContract({ address, abi: callBookAbi, functionName: "getTakes", args: [id] })) as {
      fills: number;
      takers: number;
      fees: bigint;
    };
    return { fills: Number(t.fills), takers: Number(t.takers), fees: t.fees };
  } catch {
    return null;
  }
}

/** All call ids for a caller, newest first. Null when the contract is not set or unreachable. */
export async function readCallsOf(caller: `0x${string}`): Promise<bigint[] | null> {
  const address = getCallBookAddress();
  if (!address) return null;
  try {
    const ids = (await publicClient.readContract({ address, abi: callBookAbi, functionName: "callsOf", args: [caller] })) as readonly bigint[];
    return [...ids].reverse();
  } catch {
    return null;
  }
}
