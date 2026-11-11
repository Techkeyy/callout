# Callout

**Post a perps call. Get paid when people take it.**

**[Live app](https://callout-perps.vercel.app)** · **[Live call card](https://callout-perps.vercel.app/c/1)** · **[CallBook contract](https://explorer.testnet.somnia.network/tokyo/address/0x073C82774C9067347d236cA0bA78dD822C1791B7)** · [Feedback reports](feedback/)
<!-- Demo video link -->

Callout turns a trade call into a shareable card that a follower can take on dreamDEX perps in a few clicks, with the call's stop and target already armed. It is for traders who post calls on X (callers) and the people who follow them (followers). The caller earns dreamDEX's builder fee on every follower fill, and the call is written on chain so it can't be edited later.

> *"I called it, you copied it, and I got nothing. Then you said I never called it."*

Built solo by Techkeyy for the dreamDEX Perps Builder Bounty, MVP track. Somnia Tokyo testnet only, paper USDso.

## Why this exists

Callers post calls for free and can't prove what they said before the move. Followers copy by hand, late, usually without a stop. Other projects in this bounty copy traders automatically. Callout works per call and is opt-in: you take one call, with its exits, and the caller is paid by the protocol's builder-fee rail, not by you.

```
 CALLER                      FOLLOWER                    SOMNIA
 posts call  --> card on X --> opens link, takes it --> dreamDEX fills order
 (written on chain,           (stop + target armed)      |
  can't be edited)                                       v
        ^                                      builder fee (10 bps) paid
        |                                      to the caller by the protocol
        |                                                |
        +---- takes, fills, fees on the card <-----------+
              CallBook handler run by Somnia validators
              (Reactivity) in the same block as the fill
```

## What it does

1. **Posts** a call (market, long or short, entry, stop, target, note) in one transaction. CallBook stores it. There is no edit function and no owner.
2. **Shares** it as a card at `/c/<id>` with a preview image for X.
3. **Takes** it for a follower: sets up gas, practice USDso and margin if needed, approves the caller once, fills the order, and arms the call's stop and target.
4. **Tags** each follower order with `userData = (0xCA11 << 48) | callId` through the raw PerpPool `placeOrder`, so the fill names the caller as builder.
5. **Counts** the take on chain. CallBook subscribes to dreamDEX MarginBank's `BuilderFeeCharged(payer, builder, perpPool, amount)` event with Somnia Reactivity. A validator runs the handler in the same block as the fill and credits the take to the caller's open call on that market. No server, no database, no indexer.
6. **Pays** the caller. The builder fee lands in the caller's MarginBank balance, and the caller withdraws it from their page (`/u/<address>`).
7. **Closes** early from the card if the follower wants out. Closes carry no builder tag, so they are not counted as takes.

The take sizes margin so the liquidation price sits beyond the call's stop: margin is at least notional x (stop distance + maintenance margin + 2%). The liquidation price is shown before you confirm.

## Proof on chain

All on Somnia Tokyo testnet (chain 50383). Explorer: `https://explorer.testnet.somnia.network/tokyo/tx/<hash>`.

| What | Tx |
|---|---|
| Reactivity subscription created (id 38487587) | [`0x99d52128...8787`](https://explorer.testnet.somnia.network/tokyo/tx/0x99d5212821a55bd2eb348882a9c1afad2556e730d8c29cc1c71d757c0a8b8787) |
| Follower take, builder-tagged fill (block 47023302) | [`0x13ef1b70...e69e`](https://explorer.testnet.somnia.network/tokyo/tx/0x13ef1b70d3187563f7cafdbdd526156d9424a406804ffe003facf8e138f0e69e) |
| Validator-run handler crediting the take, same block | [`0x7a680f04...f15c`](https://explorer.testnet.somnia.network/tokyo/tx/0x7a680f04be617a7f5616792b526a598adb7848db173639aaaa9c9707176ff15c) |
| Script-level loop: builder-tagged fill, caller paid 0.019193278 USDso (10 bps of about $19.19) | [`0x5cc71549...8fbc`](https://explorer.testnet.somnia.network/tokyo/tx/0x5cc715498e917e9848d903f9704df44050c5b07b5171df8ea00a606f42498fbc) |
| Caller withdrew that fee | [`0xb27ad347...8a99`](https://explorer.testnet.somnia.network/tokyo/tx/0xb27ad3473fca9328db1e3a0bd2d0b1ba6bf99963366414ffeb8bc22cc1048a99) |
| Follower via the web UI, fresh wallet: margin deposit | [`0xf13fba06...9f2e`](https://explorer.testnet.somnia.network/tokyo/tx/0xf13fba069906cf3e30e1fbb0548236bb4f13685d67a0fbf2d9445cd6b29c9f2e) |
| Same follower: take plus stop and target | [`0xaef14392...5121`](https://explorer.testnet.somnia.network/tokyo/tx/0xaef1439227be999b91ec2e5a717995dcf686f799cf7d0690f1e72de213515121) |
| Same follower: close, then cancel exits | [`0x47957ed3...7d57`](https://explorer.testnet.somnia.network/tokyo/tx/0x47957ed3aad57a1c4b861ddc191daf490a96d75eb16fe20cafe0c620537e7d57), [`0x314a3a1a...f7f5`](https://explorer.testnet.somnia.network/tokyo/tx/0x314a3a1a5e2c8c8ac8935daaba050ac7376c5c8d71b9c5e333ac7b2cb254f7f5) |
| Caller via the web UI: post a call | [`0xf278020f...4537`](https://explorer.testnet.somnia.network/tokyo/tx/0xf278020fba8352d60ddc246a46f53a000ad4b67ddd5842870fca5f1cfe944537) |
| Caller via the web UI: withdraw earnings | [`0xaed150ab...9c84`](https://explorer.testnet.somnia.network/tokyo/tx/0xaed150ab6a24d574c68687d6d8e0af30689c5076c0450eea12133d7f07249c84) |

At the time of writing, [call #1](https://callout-perps.vercel.app/c/1) shows 2 takers, 3 fills and 0.0589 USDso earned, all counted on chain. It keeps changing, so open the card for the current numbers.

## Why Somnia Reactivity matters here

Counting takes looked easy and wasn't. The dreamDEX indexer can't filter orders by the `userData` tag, and it doesn't index perp builder fees. The RPC limits `eth_getLogs` to about 1000 blocks. Any server-side attribution would have been a fragile scraper. Reactivity let the contract listen to the fee event itself, so the take is recorded in the same block as the fill, by the chain.

dreamDEX lists builder codes and fee rebates as roadmap item #2. Perp pools already allow a 10 bps builder fee on chain, and Callout uses it today. Perp builder fees are credited to the builder's MarginBank balance (withdraw with `withdrawMargin`), not the pool vault.

## How I tried to break it

| Input | Result |
|---|---|
| Price feed is stale | Take is blocked. The app reads dreamDEX's on-chain mark (`getPerpState`), not the indexer snapshot, which sat stale for over an hour |
| Margin would liquidate before the stop | Margin is sized past the stop distance, the liquidation price is shown, and the take is blocked if the stop wouldn't fire first. An early UI version sized margin at the minimum and was caught in testing |
| dreamDEX practice-USDso voucher claim reverts for a plain wallet | The app simulates first and routes to a normal deposit instead of sending a failing tx |
| Tokyo RPC degraded (calls hung, "node not ready") | A failed read is shown as a failed read, not as "contract not configured". That masking bug was found on the profile page and fixed |
| Follower closes the position | Close has no builder tag, so it is not counted as a take |
| Someone who isn't the caller tries to close a call | Rejected by the contract |
| Caller tries to change a posted call | No edit function exists, and a test checks terms stay identical across time and close |
| Second open call by the same caller on the same market | Rejected: one open call per caller per market |
| Zero pool or zero prices in a post | Reverts |

**A stale or missing price never turns into a take.** The contract decides what counts, and the app blocks unsafe takes before they are sent.

Tests: `forge test` runs 34 passing, `vitest` runs 52 passing (take sizing, liquidation and stop checks, price handling).

## Quickstart

Easiest is the live app: https://callout-perps.vercel.app. You need a browser wallet on Somnia Tokyo testnet and a little STT from the [faucet](https://explorer.testnet.somnia.network/tokyo/faucet).

To run it locally:

```bash
git clone https://github.com/Techkeyy/callout
cd callout/web
npm install

cp .env.example .env.local
# set in .env.local:
# NEXT_PUBLIC_CALLBOOK_ADDRESS=0x073C82774C9067347d236cA0bA78dD822C1791B7
# NEXT_PUBLIC_SITE_URL=http://localhost:3000

npm run dev
```

Run the tests:

```bash
cd contracts && forge test
cd ../web && npx vitest run
```

Script-level proof of the money loop lives in `spike/`. It needs a funded testnet key in `spike/.env`, which is never committed.

## Architecture

| Piece | Job |
|---|---|
| `contracts/src/CallBook.sol` | Immutable call record, take ledger, Reactivity handler for `BuilderFeeCharged` |
| `web/src/lib/take.ts` | Sizes margin past the stop, computes liquidation, gates unsafe takes |
| `web/src/lib/dex.ts` | dreamDEX perp calls: deposit, approve, tagged `placeOrder`, stop and target, close |
| `web/src/lib/mark.ts`, `prices.ts` | Live on-chain mark price and stale checks |
| `web/src/lib/callbook.ts`, `calls.ts` | Reads calls and the take ledger from CallBook |
| `web/src/lib/wallet.tsx` | Injected-wallet provider, no wagmi |
| `web/src/components/Composer.tsx` | Write and post a call |
| `web/src/components/TakePanel.tsx` | Follower flow on a call card |
| `web/src/components/Earnings.tsx` | Caller earnings and withdraw |
| `web/src/app/c/[id]` | Call card page and share image |

Stack: Next.js 16, viem, `@somnia-chain/markets-sdk` 0.33, Solidity 0.8.30 with Foundry, Somnia Reactivity, Vercel.

## Limits

- Testnet only, paper USDso. No real funds.
- dreamDEX's practice-USDso voucher claim reverts for some plain wallets. The app checks first and routes to deposit.
- Prices come from dreamDEX's on-chain mark. If it is stale, takes are blocked.
- One open call per caller per market.
- The Reactivity subscription is funded with 33 STT held by the contract. It pays handler gas and can't be withdrawn.
- A leaderboard ranked by followers' outcomes is not built yet.

## X posts

<!-- X post 1 link -->
<!-- X post 2 link -->
<!-- X post 3 link -->

## dreamDEX feedback

I hit two reproducible problems while building, written up with steps, expected and actual results in [feedback/](feedback/):

1. [Indexer: `userData` `_eq` filter returns "database query error"](feedback/01-indexer-userdata-filter.md) unless the query is also scoped to an owner.
2. [SDK: `trader.placeOrder` on a perp pool fails in preflight with `marketExpiryNs reverted`](feedback/02-sdk-placeorder-on-perp-pool-marketexpiryns.md). Callout uses the raw PerpPool `placeOrder` instead.

## License

[MIT](LICENSE)
