import { SomniaMarkets, SOMNIA_HIDEKI_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { defineChain } from "viem";
const chain = defineChain({ id: 50383, name: "H", nativeCurrency:{name:"STT",symbol:"STT",decimals:18}, rpcUrls:{default:{http:["https://api.hideki2.infra.testnet.somnia.network"],webSocket:["wss://api.hideki2.infra.testnet.somnia.network/ws"]}}});
const x = new SomniaMarkets({ chain, indexerUrl:"https://hideki-dev.smk.somnia.host/v1/graphql", wsRpcUrl:"wss://api.hideki2.infra.testnet.somnia.network/ws", addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES });
const m = Object.values(await x.loadMarkets(true)).find(m=>m.type==="swap"&&m.symbol.startsWith("BTC/"));
console.log("loadMarkets markPrice", m.info.markPrice, "indexPrice", m.info.indexPrice);
const pool = m.info.poolAddress;
for (const fn of ["getPerpState","getPerpFundingPremium","getBookTopsOnchain"]) { try { const r = await x.client[fn]?.(fn==="getBookTopsOnchain"?{pools:[pool]}:pool); console.log(fn, JSON.stringify(r,(k,v)=>typeof v==="bigint"?v.toString():v).slice(0,300)); } catch(e){ console.log(fn,"ERR",(e.message||"").slice(0,100)); } }
process.exit(0);
