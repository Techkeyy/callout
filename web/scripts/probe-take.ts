// Diagnose a failing take: simulate the exact order the app sends for a call, as a given wallet,
// and print the decoded revert. Run: node --experimental-strip-types scripts/probe-take.ts <callId> [--who=FOLLOWER_KEY] [--usd=40]
import fs from "node:fs";
import { createPublicClient, http, BaseError, ContractFunctionRevertedError } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { perpPoolWriteAbi } from "@somnia-chain/markets-sdk";
import { callBookAbi } from "../src/lib/callbook.abi.ts";
import { HTTP_URL, somniaTokyo } from "../src/lib/chain.ts";
import * as dex from "../src/lib/dex.ts";
import { parseLiveState } from "../src/lib/mark.ts";
import { cardTag, crossingPrice, FEE_BPS_TIMES_1K, IOC, U64_MAX, notionalToQuantity } from "../src/lib/take.ts";

const keys = Object.fromEntries(
  fs.readFileSync(new URL("../../spike/.env", import.meta.url), "utf8").split(/\r?\n/).filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const id = BigInt(process.argv[2] ?? "4");
const addrArg = process.argv.find((a) => a.startsWith("--addr="))?.split("=")[1] as `0x${string}` | undefined;
const who = addrArg ? { address: addrArg } : privateKeyToAccount(keys[process.argv.find((a) => a.startsWith("--who="))?.split("=")[1] ?? "FOLLOWER_KEY"] as `0x${string}`);
const usd = BigInt(process.argv.find((a) => a.startsWith("--usd="))?.split("=")[1] ?? "40");
const CB = (process.env.CALLBOOK_ADDRESS ?? "0xc83b954b22003dbe498c47b2330699466c79661d") as `0x${string}`;
const pub = createPublicClient({ chain: somniaTokyo, transport: http(HTTP_URL) });
const call = (await pub.readContract({ address: CB, abi: callBookAbi, functionName: "getCall", args: [id] })) as any;
console.log("call", id.toString(), call.isLong ? "LONG" : "SHORT", "pool", call.pool, "caller", call.caller, "expiresAt", call.expiresAt.toString());
const fx = dex.makeMarkets();
const all = await fx.loadMarkets(true);
const m = Object.values(all).find((x: any) => x.type === "swap" && String(x.info.poolAddress).toLowerCase() === call.pool.toLowerCase()) as any;
const live = parseLiveState((await fx.client.getPerpState(call.pool)) as never);
console.log("market", m?.symbol, "mark", live?.markPrice, "ok", live?.markOk, "tick", m.info.tickSize, "minQty", m.info.minQuantity, "lot", m.info.lotSize);
const mark = BigInt(live!.markPrice);
const qty = notionalToQuantity(usd * 10n ** 18n, mark, { baseDecimals: Number(m.info.baseDecimals), lotSize: BigInt(m.info.lotSize), minQuantity: BigInt(m.info.minQuantity), maxQuantity: null });
const price = crossingPrice(mark, BigInt(m.info.tickSize), call.isLong);
const args = [call.isLong, cardTag(id), price, qty, U64_MAX, IOC, 0, call.caller, FEE_BPS_TIMES_1K] as const;
const approval = await fx.client.getBuilderApproval({ pool: call.pool, user: who.address, builder: call.caller } as never);
const acct = await fx.client.getMarginAccount(String(m.info.marginBank).toLowerCase() as `0x${string}`, who.address);
console.log("wallet", who.address, "builder approval for this caller on this market:", String(approval), "(needs >= 10000) | free margin", String(acct.unlockedCollateralBalance));
console.log("order", { isBid: call.isLong, price: price.toString(), qty: qty.toString() });
try {
  await pub.simulateContract({ address: call.pool, abi: perpPoolWriteAbi, functionName: "placeOrder", args, account: who.address } as never);
  console.log("SIMULATION OK: the order would go through for", who.address);
} catch (e) {
  const err = e as BaseError;
  const rev = err.walk?.((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | undefined;
  console.log("SIMULATION REVERTED:", rev?.data?.errorName ?? "(unnamed)", JSON.stringify(rev?.data?.args ?? [], (_, v) => (typeof v === "bigint" ? v.toString() : v)), "|", err.shortMessage);
}
process.exit(0);
