// Feedback 05 repro: decodes the BuilderFeeCharged, OrderPlaced and OrderFilled logs of a take. Run: node --experimental-strip-types scripts/probe-fee-logs.ts <txHash>
import { createPublicClient, http, decodeEventLog } from "viem";
import { marginBankEventsAbi, orderBookEventsAbi } from "@somnia-chain/markets-sdk";
import { HTTP_URL, somniaTokyo } from "../src/lib/chain.ts";
const pub = createPublicClient({ chain: somniaTokyo, transport: http(HTTP_URL) });
const abi = [...marginBankEventsAbi, ...orderBookEventsAbi] as any;
for (const h of process.argv.slice(2)) {
  const r = await pub.getTransactionReceipt({ hash: h as `0x${string}` });
  console.log("==", h, "block", r.blockNumber);
  for (const l of r.logs) {
    try { const d: any = decodeEventLog({ abi, data: l.data, topics: l.topics });
      if (["BuilderFeeCharged", "OrderPlaced", "OrderFilled", "FeeCharged"].includes(d.eventName))
        console.log(" ", l.address.slice(0, 10), d.eventName, JSON.stringify(d.args, (k, v) => (typeof v === "bigint" ? v.toString() : v)).slice(0, 400));
    } catch {}
  }
}
