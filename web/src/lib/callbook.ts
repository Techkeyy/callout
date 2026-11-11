import { getAddress, isAddress } from "viem";

export { callBookAbi } from "./callbook.abi";

export interface Call {
  caller: `0x${string}`;
  pool: `0x${string}`;
  isLong: boolean;
  postedAt: bigint;
  expiresAt: bigint;
  closedAt: bigint;
  entry: bigint;
  stop: bigint;
  target: bigint;
  /** Follower notional the bond covers, 18-decimal USDso. */
  capacity: bigint;
  note: string;
}

export const NOTE_MAX = 280;

/** The deployed address, or null when NEXT_PUBLIC_CALLBOOK_ADDRESS is unset or malformed. */
export function getCallBookAddress(): `0x${string}` | null {
  const raw = process.env.NEXT_PUBLIC_CALLBOOK_ADDRESS?.trim();
  if (!raw || !isAddress(raw)) return null;
  return getAddress(raw);
}

export const ERROR_MESSAGES: Record<string, string> = {
  BadPrices: "The prices do not line up. A long needs stop below the live price and entry, target above both. A short is the reverse.",
  BadExpiry: "That expiry is not allowed. Pick one of the listed durations.",
  NoteTooLong: "Your note is too long. Keep it to 280 characters.",
  ZeroPool: "No market was picked. Choose a market and try again.",
  PoolNotRegistered: "This market is not registered on dreamDEX, so it cannot take calls.",
  EntryOffMarket: "Your entry is more than 0.5% away from the live price. Move it closer, or use the live price.",
  StopTooTight: "Your stop is too close to your entry. Keep it at least 0.1% away.",
  StopTooWide: "Your stop is too far from your entry. Keep it within 10%.",
  RewardBelowRisk: "Your target must be at least as far from your entry as your stop is.",
  ZeroCapacity: "Enter a follower capacity above zero.",
  NotCaller: "Only the person who posted this call can close it.",
  AlreadyClosed: "This call is already closed.",
  NoSuchCall: "This call does not exist.",
  AlreadyOpen: "You already have an open call on this market. Close it first.",
  BondTooSmall: "Your bond is too small. It must be at least the minimum and at least 2% of your follower capacity.",
  TransferFailed: "The bond could not be moved. Check that you have enough USDso and that you approved it, then try again.",
  StalePrice: "The price feed is stale right now, so the call cannot be checked or recorded yet. Try again in a moment.",
  NotResolvable: "The price is no longer past the target or the stop, so there is nothing to record yet. Nothing changed.",
  AlreadyResolved: "This call has already been resolved.",
  NotClaimable: "This call cannot be settled yet, so there is nothing to claim.",
  AlreadyClaimed: "You have already claimed from this call.",
  NothingToClaim: "There is nothing for you to claim on this call.",
};

/** Minimal ERC-20 surface for the bond token. */
export const erc20Abi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "o", type: "address" },
      { name: "s", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "s", type: "address" },
      { name: "v", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

/** The bond fallback used only if minBond() cannot be read. */
export const DEFAULT_MIN_BOND = 5n * 10n ** 18n;
export const DEFAULT_BOND_USDSO = 10;

export type DescribedError = { kind: "rejected" } | { kind: "error"; message: string };

/** Turn a viem/wagmi error into plain words. A wallet rejection is not an error. */
export function describeError(err: unknown): DescribedError {
  const e = err as {
    shortMessage?: string;
    message?: string;
    walk?: (fn: (x: unknown) => boolean) => unknown;
  };
  let rejected = false;
  let customName: string | undefined;
  const check = (x: unknown): boolean => {
    const o = x as { name?: string; code?: number; errorName?: string; data?: { errorName?: string } } | undefined;
    if (!o) return false;
    if (o.name === "UserRejectedRequestError" || o.code === 4001) rejected = true;
    const n = o.data?.errorName ?? o.errorName;
    if (n && ERROR_MESSAGES[n]) customName = n;
    return false;
  };
  try {
    if (typeof e?.walk === "function") e.walk(check);
    else check(e);
  } catch {
    /* ignore */
  }
  if (rejected) return { kind: "rejected" };
  if (customName) return { kind: "error", message: ERROR_MESSAGES[customName] };
  const text = `${e?.shortMessage ?? ""} ${e?.message ?? ""}`;
  for (const name of Object.keys(ERROR_MESSAGES)) {
    if (text.includes(name)) return { kind: "error", message: ERROR_MESSAGES[name] };
  }
  if (/user rejected|denied transaction|rejected the request/i.test(text)) return { kind: "rejected" };
  if (/insufficient funds/i.test(text)) {
    return { kind: "error", message: "Your wallet has no STT for gas. Get testnet STT, then try again." };
  }
  return { kind: "error", message: "Something went wrong sending the call. Nothing was posted. Try again." };
}
