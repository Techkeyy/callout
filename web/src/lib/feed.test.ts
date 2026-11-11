import { describe, expect, it } from "vitest";
import { isOpenCall, sortBySoonestExpiry } from "./feed";

describe("explore feed rules", () => {
  it("counts only unexpired, unclosed, unsettled calls as open", () => {
    const c = { expiresAt: 2000n, closedAt: 0n };
    expect(isOpenCall(c, "open", 1000)).toBe(true);
    expect(isOpenCall(c, "open", 2000)).toBe(false);
    expect(isOpenCall(c, "hit", 1000)).toBe(false);
    expect(isOpenCall({ ...c, closedAt: 5n }, "open", 1000)).toBe(false);
  });
  it("sorts by soonest expiry, newest first on a tie", () => {
    const rows = [
      { id: 1n, call: { expiresAt: 300n } },
      { id: 2n, call: { expiresAt: 100n } },
      { id: 3n, call: { expiresAt: 100n } },
    ];
    expect(sortBySoonestExpiry(rows).map((r) => r.id)).toEqual([3n, 2n, 1n]);
    expect(rows[0].id).toBe(1n);
  });
});
