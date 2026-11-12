// Decode a real tx with summarizeFill and print the numbers, to check the decoding against the chain.
// Run: node --experimental-strip-types scripts/probe-fills.ts <txhash> <poolAddress> [--addr=0x...]
import { createPublicClient, http, formatUnits } from "viem";
import { HTTP_URL, somniaTokyo } from "../src/lib/chain.ts";
import * as dex from "../src/lib/dex.ts";
import { summarizeFill, realizedPercent } from "../src/lib/fills.ts";

const hash = process.argv[2] as `0x${string}`;
const pool = process.argv[3] as `0x${string}`;
const pub = createPublicClient({ chain: somniaTokyo, transport: http(HTTP_URL) });
const receipt = await pub.getTransactionReceipt({ hash });
const account = (process.argv.find((a) => a.startsWith("--addr="))?.split("=")[1] ?? receipt.from) as `0x${string}`;
const all = await dex.makeMarkets().loadMarkets(true);
const m = Object.values(all).find((x: any) => x.type === "swap" && String(x.info.poolAddress).toLowerCase() === pool.toLowerCase()) as any;
const mb = String(m.info.marginBank).toLowerCase() as `0x${string}`;
const block = await pub.getBlock({ blockNumber: receipt.blockNumber });
const s = summarizeFill(receipt, account, pool, mb);
const f = (v: bigint | null) => (v === null ? "null" : formatUnits(v, 18));
console.log("status", receipt.status, "from", receipt.from, "block", String(receipt.blockNumber), "ts", String(block.timestamp));
console.log("realizedPnl", f(s.realizedPnl), "| fee", f(s.fee), "| builderFee", f(s.builderFee), "| avgPrice", f(s.avgPrice), "| qty", formatUnits(s.qty, m.info.baseDecimals ?? 18), "| newSize", String(s.newSize));
console.log("logs", receipt.logs.length, "bank logs", receipt.logs.filter((l) => l.address.toLowerCase() === mb).length, "pool logs", receipt.logs.filter((l) => l.address.toLowerCase() === pool.toLowerCase()).length);
console.log("baseDecimals", m.info.baseDecimals, "tick", String(m.info.tickSize));
process.exit(0);
