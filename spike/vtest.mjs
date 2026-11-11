import fs from "fs";
import { SomniaMarkets, SOMNIA_HIDEKI_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { defineChain, createPublicClient, http } from "viem"; import { privateKeyToAccount } from "viem/accounts";
const env = Object.fromEntries(fs.readFileSync(".env","utf8").trim().split(/\r?\n/).map(l=>l.split("=")));
const chain = defineChain({ id: 50383, name: "H", nativeCurrency:{name:"STT",symbol:"STT",decimals:18}, rpcUrls:{default:{http:["https://api.hideki2.infra.testnet.somnia.network"],webSocket:["wss://api.hideki2.infra.testnet.somnia.network/ws"]}}});
const x = new SomniaMarkets({ chain, indexerUrl:"https://hideki-dev.smk.somnia.host/v1/graphql", wsRpcUrl:"wss://api.hideki2.infra.testnet.somnia.network/ws", addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES, privateKey: env.TESTER_KEY });
const pc = createPublicClient({ chain, transport: http() });
const t0 = Date.now();
const call = await Promise.race([x.trader.buildClaimPerpVoucher({ marginBank: "0x478769E1177C0773c43A593DCCc4Ad15F15F1394" }), new Promise((_, r) => setTimeout(() => r(new Error("build timed out 20s")), 20000))]).catch(e => e);
console.log("build", Date.now() - t0, "ms", call instanceof Error ? call.message : JSON.stringify(call, (k,v)=>typeof v==="bigint"?v.toString():v).slice(0,300));
if (!(call instanceof Error)) { try { await pc.call({ account: privateKeyToAccount(env.TESTER_KEY).address, to: call.to, data: call.data }); console.log("simulate OK"); } catch (e) { console.log("simulate reverted:", (e.shortMessage ?? e.message).slice(0,150)); } }
process.exit(0);
