// Keeper: records outcomes on CallBook v4 for calls whose level was crossed or that have expired.
// Same order as the contract (src/lib/outcome.ts deriveOutcome): price first, then the clock. It only ever calls resolve().
// Run once:   node --experimental-strip-types scripts/keeper.ts
// Run forever: node --experimental-strip-types scripts/keeper.ts --watch      (polls every 20s)
// Only look:   node --experimental-strip-types scripts/keeper.ts --dry
// The key is read at runtime from the KEEPER_KEY env var (used by the scheduled GitHub Action), else from ../spike/.env
// (CALLER_KEY by default, --key=NAME for another). It is never printed.
import fs from "node:fs";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { callBookAbi } from "../src/lib/callbook.abi.ts";
import { HTTP_URL, somniaTokyo } from "../src/lib/chain.ts";
import * as dex from "../src/lib/dex.ts";
import { parseLiveState } from "../src/lib/mark.ts";
import { deriveOutcome, OUTCOME_LABEL } from "../src/lib/outcome.ts";

const TX = "https://explorer.testnet.somnia.network/tokyo/tx/";
const args = process.argv.slice(2);
const watch = args.includes("--watch");
const dry = args.includes("--dry");
const keyName = args.find((a) => a.startsWith("--key="))?.slice(6) ?? "CALLER_KEY";
const SCAN = 300;

function readEnvFile(rel: string): Record<string, string> {
  try {
    return Object.fromEntries(
      fs
        .readFileSync(new URL(rel, import.meta.url), "utf8")
        .split(/\r?\n/)
        .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
        .map((l) => {
          const i = l.indexOf("=");
          return [l.slice(0, i).trim(), l.slice(i + 1).trim()] as [string, string];
        }),
    );
  } catch {
    return {};
  }
}
const spike = readEnvFile("../../spike/.env");
const web = readEnvFile("../.env.local");
const CALL_BOOK = (process.env.CALLBOOK_ADDRESS ?? web.NEXT_PUBLIC_CALLBOOK_ADDRESS ?? "") as `0x${string}`;
if (!/^0x[0-9a-fA-F]{40}$/.test(CALL_BOOK)) throw new Error("CallBook address not set. Put NEXT_PUBLIC_CALLBOOK_ADDRESS in web/.env.local.");
const KEY = process.env.KEEPER_KEY || spike[keyName];
if (!dry && !KEY) throw new Error(`No key: set KEEPER_KEY or put ${keyName} in spike/.env`);

const pub = createPublicClient({ chain: somniaTokyo, transport: http(HTTP_URL, { timeout: 25000, retryCount: 4, retryDelay: 1500 }) });
const account = dry ? null : privateKeyToAccount(KEY as `0x${string}`);
const wc = account ? createWalletClient({ account, chain: somniaTokyo, transport: http(HTTP_URL, { timeout: 25000, retryCount: 4, retryDelay: 1500 }) }) : null;
const fx = dex.makeMarkets();

async function liveMark(pool: string): Promise<{ mark: bigint | null; ok: boolean }> {
  try {
    const s = parseLiveState((await fx.client.getPerpState(pool as `0x${string}`)) as never);
    return s ? { mark: BigInt(s.markPrice), ok: s.markOk } : { mark: null, ok: false };
  } catch {
    return { mark: null, ok: false };
  }
}

async function pass(): Promise<number> {
  const count = (await pub.readContract({ address: CALL_BOOK, abi: callBookAbi, functionName: "callCount" })) as bigint;
  const first = count > BigInt(SCAN) ? count - BigInt(SCAN) + 1n : 1n;
  const marks = new Map<string, { mark: bigint | null; ok: boolean }>();
  let sent = 0;
  let open = 0;
  for (let id = count; id >= first && id > 0n; id--) {
    const result = (await pub.readContract({ address: CALL_BOOK, abi: callBookAbi, functionName: "getResult", args: [id] })) as { outcome: number };
    if (Number(result.outcome) !== 0) continue;
    open++;
    const call = (await pub.readContract({ address: CALL_BOOK, abi: callBookAbi, functionName: "getCall", args: [id] })) as {
      pool: `0x${string}`;
      isLong: boolean;
      expiresAt: bigint;
      stop: bigint;
      target: bigint;
    };
    const k = call.pool.toLowerCase();
    if (!marks.has(k)) marks.set(k, await liveMark(call.pool));
    const m = marks.get(k)!;
    const o = deriveOutcome({ isLong: call.isLong, mark: m.mark, markOk: m.ok, stop: call.stop, target: call.target, nowSec: Math.floor(Date.now() / 1000), expiresAtSec: Number(call.expiresAt) });
    if (o === null) {
      console.log(`#${id} open, mark ${m.ok ? "inside the levels" : "not usable"}`);
      continue;
    }
    console.log(`#${id} ${OUTCOME_LABEL[o]}${dry ? " (dry run, not sent)" : ""}`);
    if (dry || !wc || !account) continue;
    try {
      const est = await pub.estimateContractGas({ address: CALL_BOOK, abi: callBookAbi, functionName: "resolve", args: [id], account: account.address });
      const hash = await wc.writeContract({ address: CALL_BOOK, abi: callBookAbi, functionName: "resolve", args: [id], gas: est * 2n, account, chain: somniaTokyo });
      const rc = await pub.waitForTransactionReceipt({ hash });
      console.log(`  resolve ${rc.status}: ${TX}${hash}`);
      sent++;
    } catch (e) {
      // The price can move back between the check and the send. That is fine: try again next pass.
      console.log(`  skipped: ${String((e as { shortMessage?: string }).shortMessage ?? (e as Error).message).slice(0, 140)}`);
    }
  }
  console.log(`pass done: ${open} open call(s), ${sent} resolved`);
  return sent;
}

do {
  try {
    await pass();
  } catch (e) {
    console.log("pass failed:", String((e as Error).message).slice(0, 160));
  }
  if (watch) await new Promise((r) => setTimeout(r, 20_000));
} while (watch);
process.exit(0);
