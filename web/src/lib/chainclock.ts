// The chain's clock, not the device's. CallBook compares expiries with block.timestamp, and
// Somnia testnet's block time has drifted hours away from wall-clock time. Every expiry the app
// sends, and every countdown or open/expired label it shows, must use chain time.
"use client";
import { useEffect, useState } from "react";
import { publicClient } from "./calls";

let offsetSec = 0; // chain time minus device time
let loaded = false;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

/** Re-read the latest block and update the offset (deduplicated). */
export function syncChainClock(): Promise<void> {
  inflight ??= publicClient
    .getBlock({ blockTag: "latest" })
    .then((b) => {
      offsetSec = Number(b.timestamp) - Math.floor(Date.now() / 1000);
      loaded = true;
      listeners.forEach((l) => l());
    })
    .catch(() => {
      /* keep the last known offset */
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Current chain time in seconds (device time until the first sync lands). */
export function chainNowSec(): number {
  return Math.floor(Date.now() / 1000) + offsetSec;
}

/** The exact chain time right now, read from the latest block. Use it for anything sent to the contract. */
export async function chainTimeExact(): Promise<number> {
  const b = await publicClient.getBlock({ blockTag: "latest" });
  offsetSec = Number(b.timestamp) - Math.floor(Date.now() / 1000);
  loaded = true;
  return Number(b.timestamp);
}

/** Chain time in seconds, ticking every `everyMs`, re-synced with the chain every minute. */
export function useChainNow(everyMs = 1000): number {
  const [now, setNow] = useState(() => chainNowSec());
  useEffect(() => {
    const bump = () => setNow(chainNowSec());
    listeners.add(bump);
    if (!loaded) syncChainClock();
    const tick = setInterval(bump, everyMs);
    const sync = setInterval(syncChainClock, 60_000);
    return () => {
      listeners.delete(bump);
      clearInterval(tick);
      clearInterval(sync);
    };
  }, [everyMs]);
  return now;
}
