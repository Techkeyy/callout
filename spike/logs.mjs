import { marginBankEventsAbi, perpPoolEventsAbi } from "@somnia-chain/markets-sdk";
import { createPublicClient, http, defineChain } from "viem";
const chain = defineChain({ id: 50383, name: "H", nativeCurrency:{name:"STT",symbol:"STT",decimals:18}, rpcUrls:{default:{http:["https://api.hideki2.infra.testnet.somnia.network"]}}});
const pc = createPublicClient({ chain, transport: http() });
const ev = marginBankEventsAbi.find(e=>e.name==="BuilderFeeCharged"); console.log(JSON.stringify(ev.inputs));
const op = perpPoolEventsAbi.find(e=>e.name==="OrderPlaced"); console.log(JSON.stringify(op?.inputs?.map(i=>i.name+(i.indexed?"*":""))));
const head = await pc.getBlockNumber();
for (const span of [1000n, 10000n, 100000n, 1000000n]) {
  try { const l = await pc.getLogs({ address: "0x478769E1177C0773c43A593DCCc4Ad15F15F1394", event: ev, args: { builder: "0xa660487cA7Be8B292a8271371419211ec21b002b" }, fromBlock: head - span, toBlock: head });
    console.log("span", span, "logs", l.length, l.map(x=>x.transactionHash+" "+x.args.amount)); } catch (e) { console.log("span", span, "ERR", e.shortMessage ?? e.message.slice(0,200)); }
}
