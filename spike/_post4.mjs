import fs from "fs";
import { createPublicClient, createWalletClient, http, parseAbi, parseUnits, defineChain, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
const env = Object.fromEntries(fs.readFileSync(".env","utf8").trim().split(/\r?\n/).map(l=>{const i=l.indexOf("=");return [l.slice(0,i),l.slice(i+1)]}));
const abi = JSON.parse(fs.readFileSync("../contracts/out-abi/CallBook.json","utf8"));
const chain = defineChain({ id: 50383, name: "T", nativeCurrency:{name:"STT",symbol:"STT",decimals:18}, rpcUrls:{default:{http:["https://api.hideki2.infra.testnet.somnia.network"]}}});
const pc = createPublicClient({ chain, transport: http(undefined,{timeout:25000,retryCount:3}) });
const acct = privateKeyToAccount(env.CALLER_KEY); const wc = createWalletClient({ account: acct, chain, transport: http() });
const CB = process.argv[2];
const ms = (await (await fetch("https://callout-perps.vercel.app/api/markets")).json()).markets;
const m = ms.find(x=>x.name==="BTC-PERP");
const pool = m.pool; const tick = BigInt(m.tickSize);
const [ok, mark] = await pc.readContract({address:pool, abi: parseAbi(["function tryGetMarkPrice() view returns (bool,uint256)"]), functionName:"tryGetMarkPrice"});
const al = v => v / tick * tick;
const entry = al(mark), stop = al(mark*98n/100n), target = al(mark*104n/100n);
const bond = parseUnits("5",18), capacity = parseUnits("250",18);
const token = await pc.readContract({address:CB,abi,functionName:"bondToken"});
const erc = parseAbi(["function approve(address,uint256) returns (bool)","function allowance(address,address) view returns (uint256)","function balanceOf(address) view returns (uint256)"]);
console.log("usdso", formatUnits(await pc.readContract({address:token,abi:erc,functionName:"balanceOf",args:[acct.address]}),18), "mark ok", ok);
if ((await pc.readContract({address:token,abi:erc,functionName:"allowance",args:[acct.address,CB]})) < bond) {
  const g = await pc.estimateContractGas({address:token,abi:erc,functionName:"approve",args:[CB,bond*100n],account:acct.address});
  const h = await wc.writeContract({address:token,abi:erc,functionName:"approve",args:[CB,bond*100n],gas:g*2n}); await pc.waitForTransactionReceipt({hash:h}); console.log("approve", h);
}
const args = [pool, true, entry, stop, target, BigInt(Math.floor(Date.now()/1000)+7*86400), "v4 smoke: 2% stop, 4% target, 250 USDso capacity.", capacity, bond];
const g = await pc.estimateContractGas({address:CB,abi,functionName:"post",args,account:acct.address});
const h = await wc.writeContract({address:CB,abi,functionName:"post",args,gas:g*2n}); const rc = await pc.waitForTransactionReceipt({hash:h});
console.log("post", rc.status, h, "est", g, "used", rc.gasUsed, "callCount", await pc.readContract({address:CB,abi,functionName:"callCount"}), "sub", await pc.readContract({address:CB,abi,functionName:"expirySubscriptionOf",args:[1n]}));
// negative: fake pool must be rejected
try { await pc.simulateContract({address:CB,abi,functionName:"post",args:["0x000000000000000000000000000000000000dEaD", ...args.slice(1)],account:acct.address}); console.log("FAKE POOL ACCEPTED (bad)"); } catch(e){ console.log("fake pool rejected:", e.shortMessage?.split("\n")[0] ?? e.message.slice(0,80), (e.cause?.data?.errorName ?? "")); }
