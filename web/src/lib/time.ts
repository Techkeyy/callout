export type CallStatus = "open" | "expired" | "closed";

export function callStatus(c: { expiresAt: bigint; closedAt: bigint }, nowSec: number): CallStatus {
  if (c.closedAt > 0n) return "closed";
  if (Number(c.expiresAt) <= nowSec) return "expired";
  return "open";
}

/** "2h 14m", "3d 4h", "45s". */
export function formatCountdown(secs: number): string {
  if (secs <= 0) return "0s";
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatPosted(sec: number): string {
  const d = new Date(sec * 1000);
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }) + " UTC";
}

export function shortAddress(a: string): string {
  return a.length > 10 ? `${a.slice(0, 6)}...${a.slice(-4)}` : a;
}
