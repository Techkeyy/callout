import fs from "fs";
import { createPublicClient, http, formatUnits, parseAbi, defineChain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
const env = Object.fromEntries(fs.readFileSync(".env","utf8").trim().split(/\r?\n/).map(l=>l.split("=")));
const chain = defineChain({ id: 50383, name: "Hideki", nativeCurrency:{name:"STT",symbol:"STT",decimals:18}, rpcUrls:{default:{http:["https://api.hideki2.infra.testnet.somnia.network"]}}});
const pc = createPublicClient({ chain, transport: http() });
const USDSO = "0xed7993A74dAe1e6656B704A424DcD8711aAf4F72";
const erc = parseAbi(["function balanceOf(address) view returns (uint256)","function decimals() view returns (uint8)"]);
const dec = await pc.readContract({address:USDSO,abi:erc,functionName:"decimals"});
for (const k of ["CALLER_KEY","FOLLOWER_KEY"]) { const a = privateKeyToAccount(env[k]).address;
  console.log(k, a, formatUnits(await pc.getBalance({address:a}),18), "STT", formatUnits(await pc.readContract({address:USDSO,abi:erc,functionName:"balanceOf",args:[a]}),dec), "USDso(perps collateral)"); }
