# Builder approval is keyed to (pool, fee recipient): a platform that pays its creators directly makes every user approve every creator on every market
Severity: normal
Area: contracts / UX

## Steps to reproduce
1. On Hideki (chain 50383), a user who wants to place an order with a builder fee first calls `approveBuilder({ pool, builder, maxFeeBpsTimes1k })`. The SDK documents that "the approval is per-pool". The follower `0x5Eb1…45FF` approved the caller `0x8284…0d58` on the BTC perp pool in [0xfcc3d412…d830](https://explorer.testnet.somnia.network/tokyo/tx/0xfcc3d41220f3c4c45dfb84334b176032d719388af029dc3df77217523222d830) before taking a Callout call.
2. Read the same user's approvals across two perp pools and three builders. `getBuilderApproval(user, builder)` is read on each pool (repro: `cd web && node --experimental-strip-types scripts/probe-builder-approvals.ts`).
3. Place an order on a pool, or for a builder, that the user has not approved. The order reverts with `BuilderFeeExceedsApproval` (`0x528c953f`).

## Expected
A user can approve one platform, with a fee cap, once, and that platform can route each order's builder fee to the right recipient: a creator, a strategy or a referrer. Or at least one approval can cover a builder on every pool, since the pool's own ceiling (`getMaxBuilderFeeBpsTimes1k`) already bounds the fee.

## Actual
The approval is stored per (pool, user, builder), and the builder is also the fee recipient. Read on 2026-11-12:

| Pool | builder 0x8284 | builder 0xEFe0 | builder 0xa660 |
|---|---|---|---|
| BTC perp `0x4181…` | 10000 | 0 | 10000 |
| ETH perp `0xD6Cb…` | 10000 | 0 | 0 |

So the same user is approved for builder `0xa660` on BTC but not on ETH, and not at all for `0xEFe0`. Each missing cell is one more wallet transaction before the user can trade.

## Why it matters
Callout pays the dreamDEX builder fee straight to the trader who posted the call, so the caller is the builder. That makes the fee trustless, with no platform wallet in the middle. But it means a follower signs one extra approval for every new caller on every new market. With N callers across M markets, that's up to N × M approvals.

A platform can avoid it today only by making itself the single builder and redistributing fees off chain, which reintroduces custody and trust. This is the same gap the roadmap's builder codes and rebates would close.

## Suggested fix
- Let a builder name a per-order fee recipient (or a builder code that maps to one), with the user's approval held by the builder rather than the recipient.
- Or add a pool-agnostic approval (approve this builder on every pool, capped by each pool's ceiling) so a user signs once per platform.

## Environment
- SDK: `@somnia-chain/markets-sdk` 0.33.0 (`approveBuilder`, `getBuilderApproval`, `getEffectiveBuilderApproval`, `BuilderApprovalRef { pool, user, builder }`)
- Network: Somnia Tokyo testnet (Hideki, chain 50383). Pools: BTC perp `0x4181dd08e73bbcdd1ba3e615a18f6abd941b94c0`, ETH perp `0xD6Cb1DD58580B84D76068aC21594219ce03aeddf`
- Wallet: 0x5Eb1893EE7522309FC2f9b73588c245B03d345FF (follower)
