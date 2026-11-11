// Pure helpers for sharing a call. No imports.

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

/** "i just called long btc-perp at 73,741. stop 72,266, target 76,690. 5 usdso bond says i'm right. take it on callout:" */
export function callShareText(c: ShareCall): string {
  const side = c.isLong ? "long" : "short";
  const bond = c.bond ? ` ${c.bond} usdso bond says i'm right.` : "";
  return `i just called ${side} ${c.market.toLowerCase()} at ${c.entry}. stop ${c.stop}, target ${c.target}.${bond} take it on callout:`;
}

export function takeShareText(c: ShareCall): string {
  const side = c.isLong ? "long" : "short";
  return `i just took a ${side} ${c.market.toLowerCase()} call on callout. entry ${c.entry}, stop ${c.stop}, target ${c.target}. stop and target armed. take it too:`;
}

export function hitShareText(c: ShareCall): string {
  const side = c.isLong ? "long" : "short";
  return `called it. my ${side} ${c.market.toLowerCase()} call hit its target at ${c.target}. the outcome is on chain. see the record:`;
}

/** The X web intent link for a text and a url. */
export function xIntentUrl(text: string, url: string): string {
  const q = new URLSearchParams({ text, url });
  return `${X_INTENT}?${q.toString().replace(/\+/g, "%20")}`;
}

/** The absolute card URL. */
export function cardUrl(origin: string, id: string | bigint): string {
  return `${origin.replace(/\/+$/, "")}/c/${id.toString()}`;
}
