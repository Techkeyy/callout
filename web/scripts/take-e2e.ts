// Real-chain proof of the take loop, through the same lib code the UI calls (src/lib/dex.ts, take.ts).
// Run: node --experimental-strip-types scripts/take-e2e.ts
// Keys are read at runtime from ../spike/.env and never printed or copied.
import fs from "node:fs";
import { createPublicClient, createWalletClient, formatUnits, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { callBookAbi } from "../src/lib/callbook.abi.ts";
import { HTTP_URL, somniaTokyo } from "../src/lib/chain.ts";
import * as dex from "../src/lib/dex.ts";
import { callerFee, crossingPrice, notionalOf, notionalToQuantity, unrealizedPnl } from "../src/lib/take.ts";

const CALL_BOOK = "0x073C82774C9067347d236cA0bA78dD822C1791B7" as const;
const CALL_ID = 1n;
const TX = "https://explorer.testnet.somnia.network/tokyo/tx/";
const env = Object.fromEntries(
  fs
    .readFileSync(new URL("../../spike/.env", import.meta.url), "utf8")
    .trim()
    .split(/\r?\n/)
    .map((l) => l.split("=") as [string, string]),
);
const u = (v: bigint, d = 18) => formatUnits(v, d);
const link = (r: { hash?: string } | null) => (r?.hash ? TX + r.hash : "(skipped)");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const pub = createPublicClient({ chain: somniaTokyo, transport: http(HTTP_URL) });
const mk = (key: string) => {
  const account = privateKeyToAccount(key as `0x${string}`);
  const wc = createWalletClient({ account, chain: somniaTokyo, transport: http(HTTP_URL) });
  return { account: account.address, wc, fx: dex.makeMarkets(wc) };
};
const follower = mk(env.FOLLOWER_KEY);
const callerW = mk(env.CALLER_KEY);

// market info, same source the app uses
const all = await follower.fx.loadMarkets(true);
const btc = Object.values(all).find((m: any) => m.type === "swap" && m.symbol.startsWith("BTC/")) as any;
const i = btc.info;
const market: dex.DexMarket = {
  pool: i.poolAddress,
  marginBank: i.marginBank,
  stopRegistry: i.stopRegistry,
  quoteToken: i.quoteToken,
  tickSize: BigInt(i.tickSize),
  minQuantity: BigInt(i.minQuantity),
  lotSize: BigInt(i.lotSize),
  baseDecimals: Number(i.baseDecimals),
  markPrice: BigInt(i.markPrice),
};
const fctx: dex.Ctx = { fx: follower.fx, pub: pub as any, wc: follower.wc, account: follower.account, market };
const cctx: dex.Ctx = { fx: callerW.fx, pub: pub as any, wc: callerW.wc, account: callerW.account, market };

const call = (await pub.readContract({ address: CALL_BOOK, abi: callBookAbi, functionName: "getCall", args: [CALL_ID] })) as any;
const takes0 = (await pub.readContract({ address: CALL_BOOK, abi: callBookAbi, functionName: "getTakes", args: [CALL_ID] })) as any;
console.log("call", CALL_ID.toString(), "caller", call.caller, "long", call.isLong, "entry", u(call.entry), "stop", u(call.stop), "target", u(call.target), "closedAt", call.closedAt.toString());
console.log("takes before:", takes0.takers, "takers", takes0.fills, "fills", u(takes0.fees), "fees");
console.log("mark", u(market.markPrice), "tick", u(market.tickSize), "lot", market.lotSize.toString(), "min", market.minQuantity.toString());
if (call.caller.toLowerCase() !== callerW.account.toLowerCase()) throw new Error("caller key does not match call #1");

// 1. readiness
const rd = await dex.readReadiness({ ...fctx, builder: call.caller });
console.log("1. follower readiness: STT", u(rd.stt), "wallet USDso", u(rd.walletUsdso), "margin", u(rd.margin), "builder approval", rd.builderApproval.toString(), "voucher eligible", rd.voucherEligible);
const pos0 = await dex.readPosition(fctx);
const legs0 = await dex.readBracket(fctx);
console.log("   starting position size", pos0.size.toString(), "avg entry", u(pos0.avgEntryPrice), "| live stop legs", legs0.length);

// 2. approval (skipped when already approved)
const appr = await dex.approveCaller(fctx, call.caller, rd.builderApproval);
console.log("2. approve caller:", link(appr as any));

// 3. take about $25
const price = crossingPrice(market.markPrice, market.tickSize, call.isLong);
const lim = await dex.readSizeLimit(fctx, call.isLong, price);
console.log("   size limit", JSON.stringify({ ...lim, maxQuantity: lim.maxQuantity?.toString() ?? null, lockAmount: lim.lockAmount?.toString() ?? null }));
const qty = notionalToQuantity(25n * 10n ** 18n, market.markPrice, { baseDecimals: market.baseDecimals, lotSize: market.lotSize, minQuantity: market.minQuantity, maxQuantity: lim.maxQuantity });
const notional = notionalOf(qty, market.markPrice, market.baseDecimals);
console.log("3. taking quantity", qty.toString(), "= notional", u(notional), "USDso; caller fee expected", u(callerFee(notional)));
const take = await dex.takeCall(fctx, { callId: CALL_ID, caller: call.caller, isLong: call.isLong, quantity: qty });
console.log("   take tx:", TX + take.hash, "| crossing price", u(take.price), "| position", take.before.size.toString(), "->", take.after.size.toString(), "| avg entry", u(take.after.avgEntryPrice), "| gas used", take.receipt.gasUsed.toString());

// 4. bracket
const br = await dex.armBracket(fctx, { isLong: call.isLong, stop: call.stop, target: call.target });
console.log("4. bracket tx:", link(br as any), "stopOrderId", String((br as any).stopOrderId), "paired", String((br as any).pairedStopOrderId));
let legs = await dex.readBracket(fctx);
for (let n = 0; n < 8 && legs.length < 2; n++) {
  await sleep(2000);
  legs = await dex.readBracket(fctx);
}
console.log("   armed legs read back from chain registry:", legs.map((l) => `${l.orderId}@${u(l.triggerPrice)}`).join(", "));
const pos1 = await dex.readPosition(fctx);
const pnl = unrealizedPnl(pos1.size, pos1.avgEntryPrice, market.markPrice, market.baseDecimals);
console.log("   position now: size", pos1.size.toString(), "avg entry", u(pos1.avgEntryPrice), "unrealized P&L", u(pnl), "USDso");

// 5. the ledger counted it
let takes1 = takes0;
for (let n = 0; n < 15; n++) {
  takes1 = (await pub.readContract({ address: CALL_BOOK, abi: callBookAbi, functionName: "getTakes", args: [CALL_ID] })) as any;
  if (takes1.fills > takes0.fills) break;
  await sleep(2000);
}
console.log("5. takes after:", takes1.takers, "takers", takes1.fills, "fills", u(takes1.fees), "fees | fills delta", Number(takes1.fills) - Number(takes0.fills));

// 6. close early, then cancel the bracket
const sttBefore = await pub.getBalance({ address: follower.account });
const close = await dex.closePosition(fctx);
console.log("6. close tx:", TX + close.hash, "| position", close.before.size.toString(), "->", close.after.size.toString());
const legsNow = await dex.readBracket(fctx);
const cancel = await dex.cancelBracket(fctx, legsNow);
console.log("   cancel bracket tx:", link(cancel as any), "| legs cancelled", legsNow.length);
await sleep(2000);
const legsAfter = await dex.readBracket(fctx);
const sttAfter = await pub.getBalance({ address: follower.account });
console.log("   legs left", legsAfter.length, "| STT before close", u(sttBefore), "after cancel", u(sttAfter));
const closeTakes = (await pub.readContract({ address: CALL_BOOK, abi: callBookAbi, functionName: "getTakes", args: [CALL_ID] })) as any;
console.log("   fills after close (close must not count as a take):", closeTakes.fills);

// 7. caller earnings and withdrawal
const earned = await dex.readEarned(pub as any, CALL_BOOK, callerW.account);
const acct = await callerW.fx.client.getMarginAccount(market.marginBank, callerW.account);
console.log("7. caller: earned from takes (ledger)", u(earned.ledgerFees), "over", earned.callCount, "calls,", earned.takers, "takers,", earned.fills, "fills | withdrawable perps balance", u(acct.withdrawable));
if (acct.withdrawable > 0n) {
  const w = await dex.withdrawAll(cctx, acct.withdrawable);
  console.log("   withdraw tx:", link(w as any));
  await sleep(4000);
  const acct2 = await callerW.fx.client.getMarginAccount(market.marginBank, callerW.account);
  console.log("   withdrawable after:", u(acct2.withdrawable));
}
console.log("DONE");
process.exit(0);
