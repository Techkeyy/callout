import { describe, expect, it } from "vitest";
import { callShareText, cardUrl, hitShareText, takeShareText, xIntentUrl } from "./share";

const call = { market: "BTC-PERP", isLong: true, entry: "73,741", stop: "72,266", target: "76,690", bond: "5" };

describe("share text", () => {
  it("builds the post text in lower case", () => {
    expect(callShareText(call)).toBe("i just called long btc-perp at 73,741. stop 72,266, target 76,690. 5 usdso bond says i'm right. take it on callout:");
  });
  it("handles a short and a missing bond", () => {
    expect(callShareText({ ...call, isLong: false, bond: null })).toBe("i just called short btc-perp at 73,741. stop 72,266, target 76,690. take it on callout:");
  });
  it("builds take and hit texts", () => {
    expect(takeShareText(call)).toContain("took a long btc-perp call");
    expect(hitShareText(call)).toContain("hit its target at 76,690");
  });
  it("builds the intent link with encoded text and url", () => {
    const u = new URL(xIntentUrl("a b, c:", "https://x.test/c/1"));
    expect(u.origin + u.pathname).toBe("https://x.com/intent/post");
    expect(u.searchParams.get("text")).toBe("a b, c:");
    expect(u.searchParams.get("url")).toBe("https://x.test/c/1");
    expect(xIntentUrl("a b", "u")).not.toContain("+");
  });
  it("builds the card url", () => {
    expect(cardUrl("https://callout.test/", 12n)).toBe("https://callout.test/c/12");
  });
});
