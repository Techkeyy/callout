import fs from "fs";
import { perpPoolWriteAbi } from "@somnia-chain/markets-sdk";
import { createWalletClient, createPublicClient, http, defineChain } from "viem"; import { privateKeyToAccount } from "viem/accounts";
const env = Object.fromEntries(fs.readFileSync(".env","utf8").trim().split(/\r?\n/).map(l=>l.split("=")));
const chain = defineChain({ id: 50383, name: "H", nativeCurrency:{name:"STT",symbol:"STT",decimals:18}, rpcUrls:{default:{http:["https://api.hideki2.infra.testnet.somnia.network"]}}});
const f = privateKeyToAccount(env.FOLLOWER_KEY), caller = privateKeyToAccount(env.CALLER_KEY).address;
const wc = createWalletClient({ account: f, chain, transport: http() }), pc = createPublicClient({ chain, transport: http() });
const POOL = "0x4181dd08e73bbcdd1ba3e615a18f6abd941b94c0", TAG = (0xca11n << 48n) | 1n;
const price = 75500n * 10n ** 18n;
const hash = await wc.writeContract({ address: POOL, abi: perpPoolWriteAbi, functionName: "placeOrder", gas: 10_000_000n,
  args: [true, TAG, price, 13000n, 18446744073709551615n, 2, 0, caller, 10000n] });
const r = await pc.waitForTransactionReceipt({ hash }); console.log("tagged order", hash, r.status);
await new Promise(s=>setTimeout(s,10000));
const q = `{ Order(where:{userData:{_eq:"${TAG}"}}, limit:5) { id owner userData status pool } }`;
console.log(JSON.stringify(await fetch("https://hideki-dev.smk.somnia.host/v1/graphql",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({query:q})}).then(r=>r.json())));
