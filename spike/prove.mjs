// Spike: prove a builder-tagged perp fill pays the caller, on Somnia Tokyo testnet (Hideki 50383).
// Steps: follower claims paper USDso, approves the caller as builder, takes a tiny BTC long tagged with
// builder = caller and userData = card tag, arms TP/SL; then we read the caller's builder balance and
// the caller withdraws it. Prints every tx hash.
import fs from "fs";
import { SomniaMarkets, SOMNIA_HIDEKI_TESTNET_ADDRESSES } from "@somnia-chain/markets-sdk";
import { defineChain, createPublicClient, http, formatUnits, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const env = Object.fromEntries(fs.readFileSync(".env", "utf8").trim().split(/\r?\n/).map((l) => l.split("=")));
const RPC = "https://api.hideki2.infra.testnet.somnia.network";
const WS = "wss://api.hideki2.infra.testnet.somnia.network/ws";
const INDEXER = "https://hideki-dev.smk.somnia.host/v1/graphql";
const OPERATOR_REGISTRY = "0x6B2FbfeD328FF5F20C0BE7D3C3437613aFFE8D3a";
const EXPLORER = "https://explorer.testnet.somnia.network/tokyo/tx/";
const chain = defineChain({ id: 50383, name: "Somnia Tokyo testnet", nativeCurrency: { name: "STT", symbol: "STT", decimals: 18 }, rpcUrls: { default: { http: [RPC], webSocket: [WS] } } });
const pc = createPublicClient({ chain, transport: http(RPC) });

const caller = privateKeyToAccount(env.CALLER_KEY);
const follower = privateKeyToAccount(env.FOLLOWER_KEY);
const step = process.argv[2] ?? "all";
const FEE = 10000n; // 10 bps in bps*1000
const CARD_TAG = (0xca11n << 48n) | 1n;

const mk = (privateKey) => new SomniaMarkets({ chain, indexerUrl: INDEXER, wsRpcUrl: WS, addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES, privateKey });
const log = (label, r) => console.log(label, r?.hash ? EXPLORER + r.hash : r);

for (const [n, a] of [["caller", caller], ["follower", follower]]) console.log(n, a.address, formatUnits(await pc.getBalance({ address: a.address }), 18), "STT");

const fx = mk(env.FOLLOWER_KEY);
const markets = await fx.loadMarkets(true);
const btc = Object.values(markets).find((m) => m.type === "swap" && m.symbol.startsWith("BTC/"));
const info = btc.info;
console.log("market", btc.symbol, "pool", info.poolAddress, "mark", info.markPrice, "min", info.minQuantity, "tick", info.tickSize, "baseDec", info.baseDecimals);

const pow = (d) => 10n ** BigInt(d);
const toRaw = (s, d) => { const [i, f = ""] = String(s).split("."); return BigInt(i) * pow(d) + BigInt((f + "0".repeat(d)).slice(0, d) || 0); };
const tick = BigInt(info.tickSize); // SDK market info values are already raw units
const align = (p) => (p / tick) * tick;
const mark = BigInt(info.markPrice);

if (step === "all" || step === "follow") {
  if (process.env.DEPOSIT) try { log("deposit margin", await fx.trader.depositMargin({ marginBank: info.marginBank, amount: 40n * 10n ** 18n, autoApprove: true })); } catch (e) { console.log("deposit failed:", e.shortMessage ?? e.message); }
  if (process.env.APPROVE) log("approve builder", await fx.trader.approveBuilder({ pool: info.poolAddress, builder: caller.address, maxFeeBpsTimes1k: FEE }));

  const price = align((mark * 102n) / 100n); // crossing price for an IOC buy
  const max = await fx.client.getMaxPerpOrderSize({ pool: info.poolAddress, marginBank: info.marginBank, account: follower.address, isBid: true, price, autoPull: true });
  console.log("max size", max);
  const quantity = BigInt(info.minQuantity) * 2n;

  let placed;
  try {
    placed = await fx.trader.placeOrder({ pool: info.poolAddress, isBid: true, price, quantity, orderType: 2, builder: caller.address, builderFeeBpsTimes1k: FEE, userData: CARD_TAG });
    log("place order (placeOrder + userData)", placed);
  } catch (e) {
    console.log("placeOrder with userData failed:", e.shortMessage ?? e.message, "-> trying placePerpOrder");
    placed = await fx.trader.placePerpOrder({ pool: info.poolAddress, isBid: true, price, quantity, orderType: 2, builder: caller.address, builderFeeBpsTimes1k: FEE });
    log("place order (placePerpOrder)", placed);
  }
  console.log("order result", JSON.stringify(placed, (k, v) => (typeof v === "bigint" ? v.toString() : v)));

  const tp = align((mark * 110n) / 100n), sl = align((mark * 95n) / 100n);
  try {
    const br = await fx.trader.placePerpStopOrder({ registry: info.stopRegistry, pool: info.poolAddress, operatorRegistry: OPERATOR_REGISTRY, isBid: false, quantity: 0n, triggerPrice: tp, triggerOperator: 0, stopOrderType: 1, intent: "reduceOnly", pair: { isBid: false, quantity: 0n, triggerPrice: sl, triggerOperator: 1, stopOrderType: 1 } });
    log("bracket", br);
  } catch (e) { console.log("bracket failed:", e.shortMessage ?? e.message); }
}

if (step === "all" || step === "earn") {
  // Perp builder fees are credited by MarginBank (BuilderFeeCharged(payer, builder, perpPool, amount)) to the builder's margin account.
  const acct = await fx.client.getMarginAccount(info.marginBank, caller.address).catch((e) => ({ err: e.shortMessage ?? e.message }));
  console.log("caller margin account", JSON.stringify(acct, (k, v) => (typeof v === "bigint" ? v.toString() : v)));
  const q = `{ BuilderFeeRecord(limit:5, order_by:{blockNumber:desc}) { builder payer amount token txHash pool } }`;
  console.log("indexer", JSON.stringify(await fetch(INDEXER, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: q }) }).then((r) => r.json())));
}

if (step === "withdraw") {
  const cx = mk(env.CALLER_KEY);
  const acct = await cx.client.getMarginAccount(info.marginBank, caller.address);
  console.log("withdrawable", acct.withdrawable.toString());
  if (acct.withdrawable > 0n) log("withdraw", await cx.trader.withdrawMargin({ marginBank: info.marginBank, amount: acct.withdrawable }));
}
process.exit(0);
