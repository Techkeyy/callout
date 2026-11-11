import { SomniaMarkets, SOMNIA_HIDEKI_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { defineChain } from "viem";
const chain = defineChain({ id: 50383, name: "H", nativeCurrency:{name:"STT",symbol:"STT",decimals:18}, rpcUrls:{default:{http:["https://api.hideki2.infra.testnet.somnia.network"],webSocket:["wss://api.hideki2.infra.testnet.somnia.network/ws"]}}});
const x = new SomniaMarkets({ chain, indexerUrl:"https://hideki-dev.smk.somnia.host/v1/graphql", wsRpcUrl:"wss://api.hideki2.infra.testnet.somnia.network/ws", addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES });
const j = (o)=>JSON.stringify(o,(k,v)=>typeof v==="bigint"?v.toString():v);
const mb = "0x478769E1177C0773c43A593DCCc4Ad15F15F1394";
for (const a of ["0x8284489d1B7E995544D945E732E0801df9680d58"]) {
  console.log("elig", j(await x.client.getPerpVoucherEligibility(mb, a).catch(e=>e.message)));
}
console.log("campaign", j(await x.client.getPerpVoucherCampaign?.(mb).catch(e=>e.message)));
process.exit(0);
