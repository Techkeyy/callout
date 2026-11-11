// TEST-ONLY wallet stand-in for browser UI tests. Never shipped. Signs with a key from spike/.env.
// Usage: node signer.mjs <CALLER|FOLLOWER|TESTER> [port]
import http from "http"; import fs from "fs";
import { createWalletClient, createPublicClient, http as vhttp, defineChain, hexToBigInt } from "viem";
import { privateKeyToAccount } from "viem/accounts";
const env = Object.fromEntries(fs.readFileSync(new URL(".env", import.meta.url),"utf8").trim().split(/\r?\n/).map(l=>l.split("=")));
const who = (process.argv[2] ?? "TESTER").toUpperCase(), port = Number(process.argv[3] ?? 8546);
const RPC = "https://api.hideki2.infra.testnet.somnia.network";
const chain = defineChain({ id: 50383, name: "Somnia Tokyo testnet", nativeCurrency:{name:"STT",symbol:"STT",decimals:18}, rpcUrls:{default:{http:[RPC]}}});
const account = privateKeyToAccount(env[`${who}_KEY`]);
const wc = createWalletClient({ account, chain, transport: vhttp(RPC) }); const pc = createPublicClient({ chain, transport: vhttp(RPC) });
const big = (v) => (v == null ? undefined : hexToBigInt(v));
async function handle({ method, params = [] }) {
  switch (method) {
    case "eth_requestAccounts": case "eth_accounts": return [account.address];
    case "eth_chainId": return "0x" + chain.id.toString(16);
    case "wallet_switchEthereumChain": case "wallet_addEthereumChain": return null;
    case "eth_sendTransaction": { const t = params[0]; console.log("SIGN tx to", t.to, "data", (t.data ?? "").slice(0, 10), "gas", t.gas);
      const hash = await wc.sendTransaction({ to: t.to, data: t.data, value: big(t.value), gas: big(t.gas) }); console.log(" ->", hash); return hash; }
    case "personal_sign": return wc.signMessage({ message: { raw: params[0] } });
    case "eth_signTypedData_v4": return wc.signTypedData(JSON.parse(params[1]));
    default: return pc.request({ method, params });
  }
}
http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*"); res.setHeader("Access-Control-Allow-Headers", "content-type"); res.setHeader("Access-Control-Allow-Private-Network", "true");
  if (req.method === "OPTIONS") return res.end();
  let body = ""; for await (const c of req) body += c;
  try { const r = await handle(JSON.parse(body)); res.end(JSON.stringify({ result: r ?? null })); }
  catch (e) { console.log("ERR", e.shortMessage ?? e.message); res.end(JSON.stringify({ error: { code: e.code ?? -32000, message: e.shortMessage ?? e.message } })); }
}).listen(port, () => console.log(`test signer for ${who} ${account.address} on :${port}`));
