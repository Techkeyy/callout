// Feedback 05 repro: lists indexed builder-fee records for builders that earned perp builder fees. Run: node --experimental-strip-types scripts/probe-builder-fees.ts
import * as dex from "../src/lib/dex.ts";
const fx = dex.makeMarkets();
for (const b of ["0x8284489d1b7e995544d945e732e0801df9680d58", "0xefe0412781d3c1e7888b2db9deeca3037542494d", "0xa660487ca7be8b292a8271371419211ec21b002b"]) {
  const r = await fx.client.listBuilderFees({ builder: b, limit: 20 });
  console.log(b, "records:", r.length, r.slice(0, 3).map((x: any) => `${x.pool} ${x.amount} order ${x.orderId}`).join(" | "));
}
const any = await fx.client.listBuilderFees({ limit: 10 });
console.log("any builder fees indexed:", any.length, any.slice(0, 5).map((x: any) => `${x.builder} pool ${x.pool} mkt ${x.market} amt ${x.amount}`).join("\n  "));
