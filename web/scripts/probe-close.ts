// Diagnose a failing close: simulate the exact closing order the app sends for a wallet's position
// on a call's market, and decode the revert against every dreamDEX error the SDK knows.
// Run: node --experimental-strip-types scripts/probe-close.ts <callId> --addr=0x...
import { createPublicClient, http, BaseError, ContractFunctionRevertedError, toFunctionSelector } from "viem";
import { perpPoolWriteAbi, contractErrorsAbi } from "@somnia-chain/markets-sdk";
import { callBookAbi } from "../src/lib/callbook.abi.ts";
import { HTTP_URL, somniaTokyo } from "../src/lib/chain.ts";
import * as dex from "../src/lib/dex.ts";
import { parseLiveState } from "../src/lib/mark.ts";
import { crossingPrice, IOC, U64_MAX, ZERO_ADDRESS } from "../src/lib/take.ts";

const id = BigInt(process.argv[2] ?? "4");
const who = process.argv.find((a) => a.startsWith("--addr="))!.split("=")[1] as `0x${string}`;
const CB = (process.env.CALLBOOK_ADDRESS ?? "0xc83b954b22003dbe498c47b2330699466c79661d") as `0x${string}`;
const pub = createPublicClient({ chain: somniaTokyo, transport: http(HTTP_URL) });
const call = (await pub.readContract({ address: CB, abi: callBookAbi, functionName: "getCall", args: [id] })) as any;
const fx = dex.makeMarkets();
const all = await fx.loadMarkets(true);
const m = Object.values(all).find((x: any) => x.type === "swap" && String(x.info.poolAddress).toLowerCase() === call.pool.toLowerCase()) as any;
const mb = String(m.info.marginBank).toLowerCase() as `0x${string}`;
const pos = await fx.client.getPerpPosition({ marginBank: mb, account: who, pool: call.pool });
const live = parseLiveState((await fx.client.getPerpState(call.pool)) as never);
const acct = await fx.client.getMarginAccount(mb, who);
console.log("position size", String(pos.size), "entry", String(pos.avgEntryPrice), "| mark", live?.markPrice, "ok", live?.markOk, "| free margin", String(acct.unlockedCollateralBalance), "status", acct.marginStatus);
const isLong = pos.size > 0n;
const qty = isLong ? pos.size : -pos.size;
const price = crossingPrice(BigInt(live!.markPrice), BigInt(m.info.tickSize), !isLong);
const names = new Map<string, string>();
for (const it of contractErrorsAbi as unknown as any[]) if (it.type === "error") names.set(toFunctionSelector(`${it.name}(${(it.inputs ?? []).map((i: any) => i.type).join(",")})`), it.name);
for (const [label, q] of [["full", qty], ["half", qty / 2n]] as const) {
  const args = [!isLong, 0n, price, q, U64_MAX, IOC, 0, ZERO_ADDRESS, 0n] as const;
  try {
    await pub.simulateContract({ address: call.pool, abi: perpPoolWriteAbi, functionName: "placeOrder", args, account: who } as never);
    console.log(label, "close: SIMULATION OK");
  } catch (e) {
    const err = e as BaseError;
    const rev = err.walk?.((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | undefined;
    const sel = (String(err.message).match(/0x[0-9a-f]{8}\b/) ?? [""])[0];
    console.log(label, "close: REVERTED", rev?.data?.errorName ?? names.get(sel) ?? sel, "|", err.shortMessage?.split("\n")[0]);
  }
}
process.exit(0);
