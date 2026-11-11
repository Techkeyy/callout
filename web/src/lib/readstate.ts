// Pure classification of chain-read outcomes. No imports.

/** Why a read did not produce data. "error" means the network or RPC failed, not that anything is missing. */
export type ReadFailure = "missing" | "error";

/** A call that does not exist (NoSuchCall) is "missing". Everything else, including timeouts, is "error". */
export function classifyReadError(e: unknown): ReadFailure {
  const text = `${(e as { shortMessage?: string })?.shortMessage ?? ""} ${(e as { message?: string })?.message ?? ""} ${(e as { name?: string })?.name ?? ""}`;
  return /NoSuchCall/.test(text) ? "missing" : "error";
}

export const UNREACHABLE_COPY = "Could not reach Somnia right now. Your calls are safe on chain. Refresh in a moment.";
export const NOT_CONNECTED_COPY = "The CallBook contract has not been connected to this site yet.";

export const READ_TIMEOUT_MS = 10_000;
export const READ_RETRIES = 2;
export const READ_BACKOFF_MS = 700;
