// Everything that touches dreamDEX for the take flow. Used by the UI and by scripts/take-e2e.ts, so the
// proof run exercises the same code. Imports use explicit .ts extensions so plain node can run it.
import { SomniaMarkets, SOMNIA_HIDEKI_TESTNET_ADDRESSES, perpPoolWriteAbi } from "@somnia-chain/markets-sdk";
import type { PublicClient, WalletClient } from "viem";
import { callBookAbi } from "./callbook.abi.ts";
import { INDEXER_URL, WS_URL, somniaTokyo } from "./chain.ts";
import { summarizeFill, type FillSummary } from "./fills.ts";
import { voucherUsable, cardTag, crossingPrice, FEE_BPS_TIMES_1K, IOC, U64_MAX, ZERO_ADDRESS, withRetry } from "./take.ts";

export const OPERATOR_REGISTRY = "0x6B2FbfeD328FF5F20C0BE7D3C3437613aFFE8D3a" as const;
export const STT_FAUCET_URL = "https://explorer.testnet.somnia.network/tokyo/faucet";
export const DREAMDEX_APP_URL = "https://app.testnet.dreamdex.io";

type Addr = `0x${string}`;

export interface DexMarket {
  pool: Addr;
  marginBank: Addr;
  stopRegistry: Addr;
  quoteToken: Addr;
  tickSize: bigint;
  minQuantity: bigint;
  lotSize: bigint;
  baseDecimals: number;
  markPrice: bigint;
}

/** One SDK instance. Pass a walletClient (browser wallet or a script's local account) to enable writes. */
export function makeMarkets(walletClient?: WalletClient): SomniaMarkets {
  return new SomniaMarkets({
    chain: somniaTokyo,
    indexerUrl: INDEXER_URL,
    wsRpcUrl: WS_URL,
    addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES,
    ...(walletClient ? { walletClient } : {}),
  } as never);
}

export interface Ctx {
  fx: SomniaMarkets;
  pub: PublicClient;
  /** Wallet client with an account. */
  wc: WalletClient;
  account: Addr;
  market: DexMarket;
}

const erc20BalanceAbi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "a", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
] as const;

// ---------- readiness ----------

export interface Readiness {
  stt: bigint;
  walletUsdso: bigint;
  /** Free collateral in the margin bank. */
  margin: bigint;
  withdrawable: bigint;
  builderApproval: bigint;
  /** Eligible per the chain AND a simulated claim from this wallet succeeds. */
  voucherEligible: boolean;
  voucherGrant: bigint;
}

export async function readReadiness(c: Pick<Ctx, "fx" | "pub" | "account" | "market"> & { builder: Addr }): Promise<Readiness> {
  const { fx, pub, account, market, builder } = c;
  const [stt, walletUsdso, acct, approval, voucher] = await Promise.all([
    pub.getBalance({ address: account }),
    pub.readContract({ address: market.quoteToken, abi: erc20BalanceAbi, functionName: "balanceOf", args: [account] }),
    fx.client.getMarginAccount(market.marginBank, account),
    fx.client.getBuilderApproval({ pool: market.pool, user: account, builder } as never),
    fx.client.getPerpVoucherEligibility(market.marginBank, account).catch(() => ({ eligible: false as const })),
  ]);
  const v = voucher as { eligible: boolean; grantAmount?: bigint };
  const simulates = v.eligible === true ? await claimSimulates(c) : false;
  return {
    stt,
    walletUsdso: walletUsdso as bigint,
    margin: acct.unlockedCollateralBalance,
    withdrawable: acct.withdrawable,
    builderApproval: approval as bigint,
    voucherEligible: voucherUsable(v.eligible === true, simulates),
    voucherGrant: v.grantAmount ?? 0n,
  };
}

/** Dry-run the voucher claim from this wallet. Some wallets are reported eligible but the claim still reverts. */
async function claimSimulates(c: { fx: SomniaMarkets; pub: PublicClient; account: Addr; market: DexMarket }): Promise<boolean> {
  try {
    const call = await c.fx.trader.buildClaimPerpVoucher({ marginBank: c.market.marginBank });
    await c.pub.call({ account: c.account, to: call.to, data: call.data, value: call.value });
    return true;
  } catch {
    return false;
  }
}

// ---------- setup writes ----------

export async function depositMargin(c: Ctx, amount: bigint) {
  return c.fx.trader.depositMargin({ marginBank: c.market.marginBank, amount, autoApprove: true });
}

export async function claimVoucher(c: Ctx) {
  return c.fx.trader.claimPerpVoucher({ marginBank: c.market.marginBank });
}

/** Approve the caller to earn up to 10 bps on this wallet's fills in this market. Skips when already approved. */
export async function approveCaller(c: Ctx, caller: Addr, current: bigint | null) {
  if (current !== null && current >= FEE_BPS_TIMES_1K) return null;
  return c.fx.trader.approveBuilder({ pool: c.market.pool, builder: caller, maxFeeBpsTimes1k: FEE_BPS_TIMES_1K });
}

// ---------- sizing ----------

export interface SizeLimit {
  placeable: boolean;
  maxQuantity: bigint | null;
  lockAmount: bigint | null;
  limitedBy: string | null;
}

export async function readSizeLimit(c: Pick<Ctx, "fx" | "account" | "market">, isLong: boolean, price: bigint): Promise<SizeLimit> {
  const r = (await c.fx.client.getMaxPerpOrderSize({
    pool: c.market.pool,
    marginBank: c.market.marginBank,
    account: c.account,
    isBid: isLong,
    price,
    autoPull: false,
  })) as { priceable: boolean; placeable?: boolean; maxQuantity?: bigint; lockAmount?: bigint; limitedBy?: string };
  if (!r.priceable) return { placeable: false, maxQuantity: null, lockAmount: null, limitedBy: null };
  return { placeable: r.placeable !== false, maxQuantity: r.maxQuantity ?? null, lockAmount: r.lockAmount ?? null, limitedBy: r.limitedBy ?? null };
}

/** The initial-margin rate in force for a pool, in bps. Null when it cannot be read. */
export async function readImfBps(c: Pick<Ctx, "fx" | "market">): Promise<bigint | null> {
  try {
    return await c.fx.client.getEffectiveImfBps(c.market.pool);
  } catch {
    return null;
  }
}

/** The maintenance margin of the market in bps. Null when it cannot be read. */
export async function readMmBps(c: Pick<Ctx, "fx" | "market">): Promise<bigint | null> {
  try {
    return (await c.fx.client.getPerpRiskParams(c.market.pool)).maintenanceMarginBps;
  } catch {
    return null;
  }
}

export type LiquidationRead = { ok: true; price: bigint | null } | { ok: false };

/** Where this order would put the liquidation price, given the margin the account has right now. */
export async function previewLiquidation(c: Pick<Ctx, "fx" | "account" | "market">, a: { isLong: boolean; quantity: bigint; price: bigint }): Promise<LiquidationRead> {
  try {
    const r = await c.fx.client.previewPerpLiquidationPrice({
      pool: c.market.pool,
      marginBank: c.market.marginBank,
      account: c.account,
      isBid: a.isLong,
      quantity: a.quantity,
      price: a.price,
    });
    if (!r.priceable) return { ok: false };
    return { ok: true, price: r.projectedLiquidationPrice };
  } catch {
    return { ok: false };
  }
}

// ---------- gas ----------

/** The node's estimate padded 2x. Somnia storage is costly, so never a low fixed limit. */
export function pad(gas: bigint): bigint {
  return gas * 2n;
}

// ---------- the take ----------

export interface PositionRead {
  size: bigint;
  avgEntryPrice: bigint;
}

export async function readPosition(c: Pick<Ctx, "fx" | "account" | "market">): Promise<PositionRead> {
  const p = await c.fx.client.getPerpPosition({ marginBank: c.market.marginBank, account: c.account, pool: c.market.pool });
  return { size: p.size, avgEntryPrice: p.avgEntryPrice };
}

/** One IOC order on the perp pool. The estimate runs first, so a no-fill reverts before any gas is spent. */
async function sendOrder(c: Ctx, a: { isBid: boolean; userData: bigint; price: bigint; quantity: bigint; builder: Addr; fee: bigint }) {
  const args = [a.isBid, a.userData, a.price, a.quantity, U64_MAX, IOC, 0, a.builder, a.fee] as const;
  const est = await c.pub.estimateContractGas({ address: c.market.pool, abi: perpPoolWriteAbi, functionName: "placeOrder", args, account: c.account } as never);
  const hash = await c.wc.writeContract({
    address: c.market.pool,
    abi: perpPoolWriteAbi,
    functionName: "placeOrder",
    args,
    gas: pad(est as bigint),
    account: c.wc.account ?? c.account,
    chain: somniaTokyo,
  } as never);
  const receipt = await c.pub.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error("The order was reverted.");
  return { hash, receipt };
}

/** Take a call: an IOC at mark +-1% carrying the card tag and the caller as builder. Confirms the fill by reading the position. */
export async function takeCall(c: Ctx, a: { callId: bigint; caller: Addr; isLong: boolean; quantity: bigint }) {
  const before = await readPosition(c);
  const price = crossingPrice(c.market.markPrice, c.market.tickSize, a.isLong);
  const sent = await sendOrder(c, { isBid: a.isLong, userData: cardTag(a.callId), price, quantity: a.quantity, builder: a.caller, fee: FEE_BPS_TIMES_1K });
  const after = await readPosition(c);
  const filled = after.size - before.size;
  if (filled === 0n) throw new Error("ImmediateOrCancelNoFill");
  const summary = summarizeFill(sent.receipt, c.account, c.market.pool, c.market.marginBank);
  return { ...sent, price, before, after, filled, summary, openedAt: await blockTime(c.pub, sent.receipt.blockNumber) };
}

/** The chain's timestamp for a block (seconds), or null when it cannot be read. */
export async function blockTime(pub: PublicClient, blockNumber: bigint): Promise<number | null> {
  try {
    return Number((await pub.getBlock({ blockNumber })).timestamp);
  } catch {
    return null;
  }
}

/** Arm the call's target and stop on the whole position. Locks 0.30 STT, refunded on cancel. */
export async function armBracket(c: Ctx, a: { isLong: boolean; stop: bigint; target: bigint }) {
  const exitBid = !a.isLong;
  return c.fx.trader.placePerpStopOrder({
    registry: c.market.stopRegistry,
    pool: c.market.pool,
    operatorRegistry: OPERATOR_REGISTRY,
    isBid: exitBid,
    quantity: 0n,
    triggerPrice: a.target,
    triggerOperator: a.isLong ? 0 : 1,
    stopOrderType: 1,
    intent: "reduceOnly",
    pair: { isBid: exitBid, quantity: 0n, triggerPrice: a.stop, triggerOperator: a.isLong ? 1 : 0, stopOrderType: 1 },
  } as never);
}

export interface BracketLeg {
  orderId: string;
  triggerPrice: bigint;
  isBid: boolean;
}

/** The wallet's live stop orders in this market, from the registry's indexed list. */
export async function readBracket(c: Pick<Ctx, "fx" | "account" | "market">): Promise<BracketLeg[]> {
  const rows = await c.fx.client.listPerpStopOrders({ account: c.account, pool: c.market.pool, status: ["PENDING"], limit: 20 });
  return rows
    .filter((r) => r.registry.toLowerCase() === c.market.stopRegistry.toLowerCase())
    .map((r) => ({ orderId: r.orderIdRaw, triggerPrice: BigInt(r.triggerPrice), isBid: r.isBid }));
}

/** Cancel the armed exits and get the locked STT back. */
export async function cancelBracket(c: Ctx, legs: BracketLeg[]) {
  if (legs.length === 0) return null;
  return c.fx.trader.cancelPerpStopOrders({ registry: c.market.stopRegistry, orderIds: legs.map((l) => l.orderId) });
}

/** Close the whole position: an opposite-side IOC for the full size, with no builder so it is not counted as a take. */
export async function closePosition(c: Ctx, known?: PositionRead | null) {
  // The live websocket read can be slow on testnet; use the position already on screen when we have it.
  const pos = known && known.size !== 0n ? known : await withRetry(() => readPosition(c), 3, 800);
  if (pos.size === 0n) throw new Error("There is no open position to close.");
  const isLong = pos.size > 0n;
  const qty = pos.size > 0n ? pos.size : -pos.size;
  const price = crossingPrice(c.market.markPrice, c.market.tickSize, !isLong);
  const sent = await sendOrder(c, { isBid: !isLong, userData: 0n, price, quantity: qty, builder: ZERO_ADDRESS, fee: 0n });
  const after = await readPosition(c);
  const summary: FillSummary = summarizeFill(sent.receipt, c.account, c.market.pool, c.market.marginBank);
  return { ...sent, before: pos, after, price, summary, closedAt: await blockTime(c.pub, sent.receipt.blockNumber) };
}

// ---------- earnings ----------

export interface Earnings {
  ledgerFees: bigint;
  takers: number;
  fills: number;
  callCount: number;
}

/** Sum of getTakes(id).fees over every call the wallet posted. This is the on-chain take ledger. */
export async function readEarned(pub: PublicClient, callBook: Addr, caller: Addr): Promise<Earnings> {
  const ids = (await pub.readContract({ address: callBook, abi: callBookAbi, functionName: "callsOf", args: [caller] })) as readonly bigint[];
  let fees = 0n;
  let takers = 0;
  let fills = 0;
  const rows = await Promise.all(ids.map((id) => pub.readContract({ address: callBook, abi: callBookAbi, functionName: "getTakes", args: [id] })));
  for (const t of rows as Array<{ fills: number; takers: number; fees: bigint }>) {
    fees += t.fees;
    takers += Number(t.takers);
    fills += Number(t.fills);
  }
  return { ledgerFees: fees, takers, fills, callCount: ids.length };
}

export async function withdrawAll(c: Ctx, amount: bigint) {
  return c.fx.trader.withdrawMargin({ marginBank: c.market.marginBank, amount });
}
