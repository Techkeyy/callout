// Real-chain proof of the v4 loop, through the same lib code the UI calls (src/lib/dex.ts, take.ts, outcome.ts).
// Run: node --experimental-strip-types scripts/take-e2e.ts
// Flow: caller approves and posts a call with a capacity, a bond of 2% of it, and a stop and target 0.15% from the mark (v4 needs at least 0.1%), the follower
// takes it, anyone records the outcome with resolve(), then the winner claims. Prints every tx hash.
// Keys are read at runtime from ../spike/.env and never printed or copied.
import fs from "node:fs";
import { createPublicClient, createWalletClient, decodeEventLog, formatUnits, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { callBookAbi } from "../src/lib/callbook.abi.ts";
import { HTTP_URL, somniaTokyo } from "../src/lib/chain.ts";
import * as dex from "../src/lib/dex.ts";
import { parseLiveState } from "../src/lib/mark.ts";
import { deriveOutcome, outcomeFromCode, recordLine } from "../src/lib/outcome.ts";
import { alignToTick } from "../src/lib/prices.ts";
import { callerFee, notionalOf, notionalToQuantity } from "../src/lib/take.ts";

const TX = "https://explorer.testnet.somnia.network/tokyo/tx/";
const erc20 = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "o", type: "address" }, { name: "s", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "s", type: "address" }, { name: "v", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
] as const;

function readEnv(rel: string): Record<string, string> {
  return Object.fromEntries(
    fs
      .readFileSync(new URL(rel, import.meta.url), "utf8")
      .split(/\r?\n/)
      .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()] as [string, string]),
  );
}
const keys = readEnv("../../spike/.env");
const CALL_BOOK = (process.env.CALLBOOK_ADDRESS ?? readEnv("../.env.local").NEXT_PUBLIC_CALLBOOK_ADDRESS) as `0x${string}`;
const u = (v: bigint, d = 18) => formatUnits(v, d);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hashes: string[] = [];
const note = (label: string, hash: string) => {
  hashes.push(`${label}: ${TX}${hash}`);
  console.log(`   ${label} tx: ${TX}${hash}`);
};

const pub = createPublicClient({ chain: somniaTokyo, transport: http(HTTP_URL, { timeout: 25000, retryCount: 4, retryDelay: 1500 }) });
const mk = (key: string) => {
  const account = privateKeyToAccount(key as `0x${string}`);
  const wc = createWalletClient({ account, chain: somniaTokyo, transport: http(HTTP_URL, { timeout: 25000, retryCount: 4, retryDelay: 1500 }) });
  return { address: account.address, account, wc, fx: dex.makeMarkets(wc) };
};
const caller = mk(keys.CALLER_KEY);
const follower = mk(keys.FOLLOWER_KEY);

/** estimate x 2, send, wait. */
async function write(who: ReturnType<typeof mk>, address: `0x${string}`, abi: any, functionName: string, args: any[]) {
  const est = (await pub.estimateContractGas({ address, abi, functionName, args, account: who.account } as never)) as bigint;
  const hash = await who.wc.writeContract({ address, abi, functionName, args, gas: est * 2n, account: who.account, chain: somniaTokyo } as never);
  const rc = await pub.waitForTransactionReceipt({ hash });
  if (rc.status !== "success") throw new Error(`${functionName} reverted: ${hash}`);
  return { hash, rc };
}
const read = (fn: string, args: any[] = []) => pub.readContract({ address: CALL_BOOK, abi: callBookAbi, functionName: fn, args } as never) as Promise<any>;

// ---------- market and levels ----------
const all = await caller.fx.loadMarkets(true);
const btc = Object.values(all).find((m: any) => m.type === "swap" && m.symbol.startsWith("BTC/")) as any;
const i = btc.info;
const market: dex.DexMarket = {
  pool: i.poolAddress,
  marginBank: i.marginBank,
  stopRegistry: i.stopRegistry,
  quoteToken: i.quoteToken,
  tickSize: BigInt(i.tickSize),
  minQuantity: BigInt(i.minQuantity),
  lotSize: BigInt(i.lotSize),
  baseDecimals: Number(i.baseDecimals),
  markPrice: 0n,
};
// The index feed goes stale now and then (getPerpState reverts). Wait for a fresh mark instead of failing.
let live = null as ReturnType<typeof parseLiveState>;
for (let n = 0; n < 45 && !(live && live.markOk); n++) {
  live = parseLiveState((await caller.fx.client.getPerpState(market.pool).catch(() => null)) as never);
  if (!(live && live.markOk)) {
    if (n % 5 === 0) console.log("   waiting for a fresh price feed...");
    await sleep(4000);
  }
}
if (!live || !live.markOk) throw new Error("The price feed stayed stale for 3 minutes. Try again later.");
market.markPrice = BigInt(live.markPrice);
const entry = alignToTick(market.markPrice, market.tickSize);
const step = alignToTick((entry * 15n) / 10_000n, market.tickSize) || market.tickSize; // 0.15%, the v4 minimum stop is 0.1%
const target = entry + step;
const stop = entry - step;
console.log("CallBook", CALL_BOOK, "| mark", u(market.markPrice), "| entry", u(entry), "stop", u(stop), "target", u(target));

const minBond = (await read("minBond")) as bigint;
const bondToken = (await read("bondToken")) as `0x${string}`;
const bond = minBond;
const capacity = bond * 50n; // the bond must be at least 2% of capacity
const cctx: dex.Ctx = { fx: caller.fx, pub: pub as any, wc: caller.wc, account: caller.address, market };
const fctx: dex.Ctx = { fx: follower.fx, pub: pub as any, wc: follower.wc, account: follower.address, market };

// ---------- 1. caller approves and posts ----------
const bal = (await pub.readContract({ address: bondToken, abi: erc20, functionName: "balanceOf", args: [caller.address] })) as bigint;
const allowance = (await pub.readContract({ address: bondToken, abi: erc20, functionName: "allowance", args: [caller.address, CALL_BOOK] })) as bigint;
console.log("1. caller USDso", u(bal), "allowance", u(allowance), "bond", u(bond), "STT", u(await pub.getBalance({ address: caller.address })));
if (bal < bond) throw new Error("caller has too little USDso for the bond");
if (allowance < bond) {
  const a = await write(caller, bondToken, erc20, "approve", [CALL_BOOK, bond]);
  note("approve bond", a.hash);
}
const openId = (await read("openCallOf", [caller.address, market.pool])) as bigint;
if (openId !== 0n) throw new Error(`caller already has open call #${openId} on this market. Resolve or let it expire first.`);
const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 3600);
const posted = await write(caller, CALL_BOOK, callBookAbi, "post", [market.pool, true, entry, stop, target, expiresAt, "v4 proof: stop and target 0.15% from the mark", capacity, bond]);
note("post", posted.hash);
let id = 0n;
for (const log of posted.rc.logs) {
  try {
    const ev = decodeEventLog({ abi: callBookAbi, data: log.data, topics: log.topics }) as any;
    if (ev.eventName === "CallPosted") id = ev.args.id;
  } catch {
    /* not ours */
  }
}
if (id === 0n) throw new Error("could not read the call id from the receipt");
console.log("   posted call", id.toString(), "| bond held in the contract:", u(((await read("getResult", [id])) as any).bond));

// ---------- 2. follower takes ----------
const rd = await dex.readReadiness({ ...fctx, builder: caller.address });
console.log("2. follower STT", u(rd.stt), "margin", u(rd.margin), "builder approval", rd.builderApproval.toString());
const appr = await dex.approveCaller(fctx, caller.address, rd.builderApproval);
if (appr) note("approve caller", (appr as any).hash);
const qty = notionalToQuantity(20n * 10n ** 18n, market.markPrice, { baseDecimals: market.baseDecimals, lotSize: market.lotSize, minQuantity: market.minQuantity, maxQuantity: null });
const notional = notionalOf(qty, market.markPrice, market.baseDecimals);
console.log("   taking", qty.toString(), "raw = $" + u(notional), "| expected caller fee", u(callerFee(notional)));
const take = await dex.takeCall(fctx, { callId: id, caller: caller.address, isLong: true, quantity: qty });
note("take", take.hash);
console.log("   position", take.before.size.toString(), "->", take.after.size.toString());

// ---------- 3. the ledger counts the take ----------
let takes = (await read("getTakes", [id])) as any;
for (let n = 0; n < 20 && takes.fills === 0; n++) {
  await sleep(2500);
  takes = (await read("getTakes", [id])) as any;
}
console.log("3. getTakes:", takes.takers, "takers", takes.fills, "fills", u(takes.fees), "fees | feeOf(follower)", u((await read("feeOf", [id, follower.address])) as bigint));

// ---------- 4. record the outcome ----------
console.log("4. waiting for the mark to cross a level (one tick either way)...");
let resolved = false;
for (let n = 0; n < 60 && !resolved; n++) {
  const s = parseLiveState((await caller.fx.client.getPerpState(market.pool).catch(() => null)) as never);
  const would = s ? deriveOutcome({ isLong: true, mark: BigInt(s.markPrice), markOk: s.markOk, stop, target, nowSec: Math.floor(Date.now() / 1000), expiresAtSec: Number(expiresAt) }) : null;
  if (would === null) {
    await sleep(4000);
    continue;
  }
  try {
    const r = await write(caller, CALL_BOOK, callBookAbi, "resolve", [id]);
    note("resolve", r.hash);
    resolved = true;
  } catch (e) {
    console.log("   resolve not accepted yet:", String((e as { shortMessage?: string }).shortMessage ?? (e as Error).message).slice(0, 100));
    await sleep(3000);
  }
}
if (!resolved) throw new Error("the mark did not cross a level in 4 minutes. The call stays open; run the keeper later.");
const res = (await read("getResult", [id])) as any;
const rec = (await read("getRecord", [caller.address])) as any;
console.log("   result:", outcomeFromCode(res.outcome), "at price", u(BigInt(res.price)), "| caller record:", recordLine({ hits: Number(rec.hits), stops: Number(rec.stops), expired: Number(rec.expired), expiredLosses: Number(rec.expiredLosses) }));

// ---------- 5. claim ----------
for (const [label, who] of [["follower", follower], ["caller", caller]] as const) {
  const can = (await read("claimableOf", [id, who.address])) as bigint;
  console.log(`5. ${label} claimable:`, u(can), "USDso");
  if (can > 0n) {
    const before = (await pub.readContract({ address: bondToken, abi: erc20, functionName: "balanceOf", args: [who.address] })) as bigint;
    const c = await write(who, CALL_BOOK, callBookAbi, "claim", [id]);
    note(`claim (${label})`, c.hash);
    const after = (await pub.readContract({ address: bondToken, abi: erc20, functionName: "balanceOf", args: [who.address] })) as bigint;
    console.log(`   ${label} USDso balance`, u(before), "->", u(after));
  }
}
const fin = (await read("getResult", [id])) as any;
console.log("   claimedTotal", u(BigInt(fin.claimedTotal)), "of bond", u(BigInt(fin.bond)));

// ---------- 6. tidy up: close the follower position ----------
const close = await dex.closePosition(fctx);
note("close position", close.hash);
console.log("6. follower position", close.before.size.toString(), "->", close.after.size.toString());

console.log("\nALL TX:");
hashes.forEach((h) => console.log(" ", h));
console.log("DONE");
process.exit(0);
