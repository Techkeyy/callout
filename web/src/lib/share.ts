// Pure helpers for sharing. No imports. Texts are lower case and say only what is on chain.

export interface ShareCall {
  /** "BTC-PERP". Lowercased in the text. */
  market: string;
  isLong: boolean;
  /** Already formatted for display ("73,741"). */
  entry: string;
  stop: string;
  target: string;
  /** Bond already formatted ("5"), or null when unknown. */
  bond?: string | null;
}

export const X_INTENT = "https://x.com/intent/post";
/** The owner's X account. Change this one constant. */
export const X_PROFILE_URL = "https://x.com/Praise_prodigyy";
export const GITHUB_URL = "https://github.com/Techkeyy/callout";

const sideOf = (isLong: boolean) => (isLong ? "long" : "short");

// ---------- numbers ----------

/** Signed percent move from the entry to a price, for the call's direction: a long gains when the price rises, a short when it falls. Null when a price is missing. */
export function movePct(isLong: boolean, entry: bigint, price: bigint): number | null {
  if (entry <= 0n || price <= 0n) return null;
  const n = Number(((price - entry) * 1_000_000n) / entry) / 10_000;
  return isLong ? n : -n;
}

/** One decimal from 1%, two below, so a small move does not read as zero. */
export function moveDp(p: number): number {
  return Math.abs(p) >= 1 ? 1 : 2;
}

/** "+2.2%", "-1.8%", "0.0%". */
export function fmtMove(p: number): string {
  const dp = moveDp(p);
  const r = Number(p.toFixed(dp));
  if (r === 0) return `${(0).toFixed(dp)}%`;
  return `${r > 0 ? "+" : "-"}${Math.abs(r).toFixed(dp)}%`;
}

/** A taker's share of the forfeited bond: forfeit * covered / totalCovered, rounded down. 18-decimal amounts. */
export function takerPayout(forfeit: bigint, covered: bigint, totalCovered: bigint): bigint {
  if (forfeit <= 0n || covered <= 0n || totalCovered <= 0n) return 0n;
  const c = covered > totalCovered ? totalCovered : covered;
  return (forfeit * c) / totalCovered;
}

// ---------- texts ----------

/** "i just called long btc-perp at 73,741. stop 72,266, target 76,690. 5 usdso bond says i'm right. take it on callout:" */
export function callShareText(c: ShareCall): string {
  const bond = c.bond ? ` ${c.bond} usdso bond says i'm right.` : "";
  return `i just called ${sideOf(c.isLong)} ${c.market.toLowerCase()} at ${c.entry}. stop ${c.stop}, target ${c.target}.${bond} take it on callout:`;
}

export interface ResultShare {
  outcome: "hit" | "stopped" | "expired";
  isLong: boolean;
  market: string;
  /** "+2.2%", already formatted, or null. */
  move: string | null;
  /** Bond for the stopped text ("5"), or null. */
  bond: string | null;
  /** Whole percent of the bond that went to takers (expired). */
  forfeitPct: number;
  forfeit: bigint;
}

export function resultShareText(r: ResultShare): string {
  const m = r.market.toLowerCase();
  const side = sideOf(r.isLong);
  if (r.outcome === "hit") return `called it. ${side} ${m} hit target${r.move ? `, ${r.move}` : ""}. my bond came back. callout:`;
  if (r.outcome === "stopped") return `wrong on this one. my stop hit and my${r.bond ? ` ${r.bond} usdso` : ""} bond paid the people who took it. that's how callout works:`;
  if (r.forfeit <= 0n) return `my ${side} ${m} call expired in profit. bond back. every call is on chain. callout:`;
  const pct = r.forfeitPct < 1 ? "under 1%" : `${r.forfeitPct}%`;
  return `my ${side} ${m} call expired and settled at the price. ${pct} of my bond went to the people who took it. callout:`;
}

export interface TakerShare {
  /** "0xab..cd" or a handle. */
  caller: string;
  move: string | null;
  open: boolean;
  /** Bond payout already formatted ("0.40"), or null when there is none. */
  payout: string | null;
}

export function takerShareText(t: TakerShare): string {
  const mv = t.move ? ` call moved ${t.move}${t.open ? " so far" : ""}.` : "";
  const pay = t.payout ? ` the bond paid me ${t.payout} usdso.` : "";
  return `took ${t.caller}'s call on callout.${mv}${pay}`;
}

export interface RecordShare {
  hits: number;
  stops: number;
  expiredLosses: number;
  /** Whole percent, or null when there is nothing to judge. */
  rate: number | null;
}

export function recordShareText(r: RecordShare): string {
  const parts = [`${r.hits} ${r.hits === 1 ? "hit" : "hits"}`, `${r.stops} ${r.stops === 1 ? "stop" : "stops"}`];
  if (r.expiredLosses > 0) parts.push(`${r.expiredLosses} expired at a loss`);
  if (r.rate !== null) parts.push(`${Math.round(r.rate)}% hit rate`);
  return `my callout record: ${parts.join(", ")}. every call on chain, no edits:`;
}

// ---------- links ----------

/** The X web intent link for a text and a url. */
export function xIntentUrl(text: string, url: string): string {
  const q = new URLSearchParams({ text, url });
  return `${X_INTENT}?${q.toString().replace(/\+/g, "%20")}`;
}

export const telegramUrl = (text: string, url: string) => `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
export const whatsappUrl = (text: string, url: string) => `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`;
export const farcasterUrl = (text: string, url: string) => `https://warpcast.com/~/compose?text=${encodeURIComponent(text)}&embeds[]=${encodeURIComponent(url)}`;

/** The absolute call page url. */
export function cardUrl(origin: string, id: string | bigint): string {
  return `${origin.replace(/\/+$/, "")}/c/${id.toString()}`;
}

/** Any absolute url on this site. */
export function siteUrl(origin: string, path: string): string {
  return `${origin.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

/** NEXT_PUBLIC_SITE_URL when set, else the page origin (browser only). */
export function siteOrigin(): string {
  const env = process.env.NEXT_PUBLIC_SITE_URL;
  if (env) return env.replace(/\/+$/, "");
  return typeof window !== "undefined" ? window.location.origin : "";
}
