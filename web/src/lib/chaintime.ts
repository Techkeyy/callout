// Server-side chain time for server-rendered pages (the client uses chainclock.ts).
// Falls back to device time if the block read is slow, and the client re-syncs right after hydration.
import { publicClient } from "./calls";
import { withTimeout } from "./take";

export async function chainNowServer(timeoutMs = 2500): Promise<number> {
  try {
    const b = await withTimeout(publicClient.getBlock({ blockTag: "latest" }), timeoutMs);
    return Number(b.timestamp);
  } catch {
    return Math.floor(Date.now() / 1000);
  }
}
