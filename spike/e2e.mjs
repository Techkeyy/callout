import fs from "fs";
import { perpPoolWriteAbi } from "@somnia-chain/markets-sdk";
import { createWalletClient, createPublicClient, http, defineChain, parseAbi } from "viem"; import { privateKeyToAccount } from "viem/accounts";
const env = Object.fromEntries(fs.readFileSync(".env","utf8").trim().split(/\r?\n/).map(l=>l.split("=")));
const chain = defineChain({ id: 50383, name: "H", nativeCurrency:{name:"STT",symbol:"STT",decimals:18}, rpcUrls:{default:{http:["https://api.hideki2.infra.testnet.somnia.network"]}}});
const pc = createPublicClient({ chain, transport: http() });
const callerA = privateKeyToAccount(env.CALLER_KEY), fA = privateKeyToAccount(env.FOLLOWER_KEY);
const cw = createWalletClient({ account: callerA, chain, transport: http() }), fw = createWalletClient({ account: fA, chain, transport: http() });
const CB = "0x073C82774C9067347d236cA0bA78dD822C1791B7", POOL = "0x4181dd08e73bbcdd1ba3e615a18f6abd941b94c0";
const abi = JSON.parse(fs.readFileSync("../contracts/out-abi/CallBook.json","utf8"));
const tick = 10n**17n, al = (p)=>(p/tick)*tick;
const mark = 73600n * 10n**18n; // approx BTC; only ordering matters for the call terms
let id = await pc.readContract({ address: CB, abi, functionName: "openCallOf", args: [callerA.address, POOL] });
if (id === 0n) {
  const g = await pc.estimateContractGas({ address: CB, abi, functionName: "post", account: callerA, args: [POOL, true, al(mark), al(mark*95n/100n), al(mark*110n/100n), BigInt(Math.floor(Date.now()/1000)+86400), "BTC reclaiming 73k. Invalid below 70k."] });
  console.log("post gas estimate", g);
  const h = await cw.writeContract({ address: CB, abi, functionName: "post", gas: g * 2n, args: [POOL, true, al(mark), al(mark*95n/100n), al(mark*110n/100n), BigInt(Math.floor(Date.now()/1000)+86400), "BTC reclaiming 73k. Invalid below 70k."] });
  const r = await pc.waitForTransactionReceipt({ hash: h }); console.log("post", h, r.status, "gasUsed", r.gasUsed);
  id = await pc.readContract({ address: CB, abi, functionName: "openCallOf", args: [callerA.address, POOL] });
}
console.log("open call id", id);
const TAG = (0xca11n << 48n) | id;
const h2 = await fw.writeContract({ address: POOL, abi: perpPoolWriteAbi, functionName: "placeOrder", gas: 10_000_000n, args: [true, TAG, 75500n*10n**18n, 13000n, 18446744073709551615n, 2, 0, callerA.address, 10000n] });
const r2 = await pc.waitForTransactionReceipt({ hash: h2 }); console.log("take", h2, r2.status, "block", r2.blockNumber);
for (let i=0;i<10;i++) { await new Promise(s=>setTimeout(s,2000));
  const t = await pc.readContract({ address: CB, abi, functionName: "getTakes", args: [id] }); console.log("takes", JSON.stringify(t,(k,v)=>typeof v==="bigint"?v.toString():v)); if (t.fills > 0) break; }
const logs = await pc.getLogs({ address: CB, fromBlock: r2.blockNumber - 5n, toBlock: r2.blockNumber + 50n });
console.log("CallBook logs after take:", logs.map(l=>l.transactionHash+" block "+l.blockNumber));
