// Feedback 06 repro: reads a user's builder approvals per (pool, builder). Run: node --experimental-strip-types scripts/probe-builder-approvals.ts
import { createPublicClient, http } from "viem";
const binaryPoolReadAbi = [{ type: "function", name: "getBuilderApproval", stateMutability: "view", inputs: [{ type: "address", name: "user" }, { type: "address", name: "builder" }], outputs: [{ type: "uint256" }] }];
import { HTTP_URL, somniaTokyo } from "../src/lib/chain.ts";
const pub = createPublicClient({ chain: somniaTokyo, transport: http(HTTP_URL) });
const user = "0x5Eb1893EE7522309FC2f9b73588c245B03d345FF";
const pools = { "BTC 0x4181": "0x4181dd08e73bbcdd1ba3e615a18f6abd941b94c0", "ETH 0xD6Cb": "0xD6Cb1DD58580B84D76068aC21594219ce03aeddf" };
const builders = { "0x8284": "0x8284489d1B7E995544D945E732E0801df9680d58", "0xEFe0": "0xEFe0412781d3c1e7888b2DB9dEEcA3037542494d", "0xa660": "0xa660487cA7Be8B292a8271371419211ec21b002b" };
for (const [pn, pool] of Object.entries(pools)) for (const [bn, builder] of Object.entries(builders)) {
  const v = await pub.readContract({ address: pool as any, abi: binaryPoolReadAbi as any, functionName: "getBuilderApproval", args: [user, builder] });
  console.log(pn, "builder", bn, String(v));
}
