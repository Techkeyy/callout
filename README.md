# Callout

**Post a perps call. Put a bond behind it. Get paid when people take it, lose it if you get stopped.**

**[Live app](https://callout-perps.vercel.app)** · **[Live call card](https://callout-perps.vercel.app/c/2)** · **[Leaderboard](https://callout-perps.vercel.app/board)** · **[CallBook v3 contract](https://explorer.testnet.somnia.network/tokyo/address/0x7D9F2b0c5257Ac2fe12f07713971a530B389365c)** · [Feedback reports](feedback/)
<!-- Demo video link -->

Callout turns a trade call into a shareable card that a follower can take on dreamDEX perps in a few clicks, with the call's stop and target already armed. It is for traders who post calls on X (callers) and the people who follow them (followers). The caller posts with a USDso bond, earns dreamDEX's builder fee on every follower fill, and the call is written on chain so it can't be edited. If the call hits its stop, the bond goes to the people who took it.

> *"I called it, you copied it, and I got nothing. Then you said I never called it."*

Built solo by Techkeyy for the dreamDEX Perps Builder Bounty, MVP track. Somnia Tokyo testnet only, paper USDso.

## Why this exists

Callers post calls for free and can't prove what they said before the move. Followers copy by hand, late, usually without a stop. Other projects in this bounty copy traders automatically. Callout works per call and is opt-in: you take one call, with its exits, and the caller is paid by the protocol's builder-fee rail, not by you.

The first version (v2) paid callers for reach: more takers meant more fees, whether the call was right or not. An outside review pointed that out, and v3 fixes it. The caller now has skin in the game: "I called it" becomes "I put money behind it".

Why a bond and not "fee only if the target hits"? dreamDEX pays builder fees at fill time, so no contract can hold them back. The bond makes the net result conditional instead: a good call gets its bond back plus the fees, a stopped call pays its bond to the followers who took it.

```
 CALLER                     FOLLOWER                   SOMNIA
 posts call + bond  -->  opens link, takes it  -->  dreamDEX fills order
 (on chain, no edits)    (stop + target armed)       |
                                                     v
                                          builder fee (10 bps) to caller
                                          Reactivity records the take
                                                     |
   anyone calls resolve(id), reads the live mark price
        |                       |                       |
      HIT                   EXPIRED                 STOPPED
  bond back to caller    bond back to caller    bond split among takers
        |                       |               pro rata by fees paid
        +-----------+-----------+                     |
                    v                                 v
         caller record: hits / stops / expired  (hit rate on card, profile, /board)
```

## What it does

1. **Posts** a call (market, long or short, entry, stop, target, note) with a USDso bond (minimum 5) in one flow. CallBook stores it. There is no edit function and no owner.
2. **Shares** it as a card at `/c/<id>` with a preview image for X.
3. **Takes** it for a follower: sets up gas, practice USDso and margin if needed, approves the caller once, fills the order, and arms the call's stop and target.
4. **Tags** each follower order with `userData = (0xCA11 << 48) | callId` through the raw PerpPool `placeOrder`, so the fill names the caller as builder.
5. **Counts** the take on chain. CallBook subscribes to dreamDEX MarginBank's `BuilderFeeCharged(payer, builder, perpPool, amount)` event with Somnia Reactivity. A validator runs the handler in the same block as the fill and credits the take to the caller's open call on that market. No server, no database, no indexer.
6. **Resolves** the call. Anyone can call `resolve(id)`, which reads the perp pool's live `tryGetMarkPrice()`. For a long: mark at or above the target is HIT, mark at or below the stop is STOPPED, and after expiry the call is EXPIRED. A short is the mirror. A keeper (`web/scripts/keeper.ts`) runs every 10 minutes on GitHub Actions (`.github/workflows/keeper.yml`) from its own gas-only wallet, and anyone can press "Record on chain" on the card.
7. **Settles the bond.** HIT or EXPIRED returns the bond to the caller. STOPPED splits it among the takers pro rata by the builder fees they paid, and each taker claims their share. With zero takers the caller gets the bond back.
8. **Records** the outcome. Each caller has an on-chain record (hits, stops, expired), and the hit rate shows on every card, every profile and the [leaderboard](https://callout-perps.vercel.app/board).
9. **Pays** the caller the builder fee, which lands in their MarginBank balance. They withdraw it from their page (`/u/<address>`).
10. **Closes** early from the card if the follower wants out. Closes carry no builder tag, so they are not counted as takes. A caller closing a call doesn't end its exposure: a closed call can still be resolved until it expires.

The take sizes margin so the liquidation price sits beyond the call's stop: margin is at least notional x (stop distance + maintenance margin + 2%). The liquidation price is shown before you confirm.

## Proof on chain

All on Somnia Tokyo testnet (chain 50383). Explorer: `https://explorer.testnet.somnia.network/tokyo/tx/<hash>`.

### v3 (live): bond, resolve, settle

CallBook v3 `0x7D9F2b0c5257Ac2fe12f07713971a530B389365c`. Deploy tx [`0x0187b308...3d4`](https://explorer.testnet.somnia.network/tokyo/tx/0x0187b3086319bf7257abe10d714d578c3fa895cf2946d58d5e294d972eb393d4). Reactivity watch tx [`0xf65091e4...ad`](https://explorer.testnet.somnia.network/tokyo/tx/0xf65091e4024f80c020cb13032b2ff7d5187f951ad9f90a889d16e113ff2c51ad), subscription 38907707.

| What | Tx |
|---|---|
| HIT path, script level (call #1): post with bond | [`0xd3860475...6a4d`](https://explorer.testnet.somnia.network/tokyo/tx/0xd3860475d2e9a176cea3c91916187e5b22c28049b94bbfb779c57d465b876a4d) |
| HIT path: follower take | [`0xfcf872a3...339b`](https://explorer.testnet.somnia.network/tokyo/tx/0xfcf872a333811a68be34cd9d7e65ca165bada59f365b2832482e97dd4cab339b) |
| HIT path: resolve, HIT at 73,995.39 | [`0x4ee86f1e...fce6`](https://explorer.testnet.somnia.network/tokyo/tx/0x4ee86f1e149261f8f5f499b439d054c9e037aff034ffb1e826f0241ad903fce6) |
| HIT path: caller reclaims the bond | [`0xcdd75bd7...3f22`](https://explorer.testnet.somnia.network/tokyo/tx/0xcdd75bd7ae07466b5d1729739ce5a7d7fb7e33119e8bd2f765b10159689a3f22) |
| STOPPED path, through the web UI with browser wallets (call #2): caller approves the bond | [`0x2b993486...c64e`](https://explorer.testnet.somnia.network/tokyo/tx/0x2b9934862b962e54d9f604cddf1399875130aaf3ff28690a90f51d49e029c64e) |
| STOPPED path: caller posts | [`0x5427dc63...7956`](https://explorer.testnet.somnia.network/tokyo/tx/0x5427dc63ecf4117f272ce7b9b4dc149f00b29e02271c3398a5a0647824b27956) |
| STOPPED path: a different wallet presses "Record on chain", STOPPED at 73,629.9 | [`0x972b44fc...e1e3`](https://explorer.testnet.somnia.network/tokyo/tx/0x972b44fc5a6a232853720eb860623076488cfda0ae1343685a65b3a47c7ee1e3) |
| STOPPED path: the taker claims the whole 5 USDso bond (balance 27.78 to 32.78 USDso) | [`0xd23b71ed...85df`](https://explorer.testnet.somnia.network/tokyo/tx/0xd23b71edd16dfc1ca6480eb053217082e5b763833f304f07c5e6cb9ac1e685df) |

At the time of writing, the caller record on the [leaderboard](https://callout-perps.vercel.app/board) is 1 hit, 1 stopped, a 50% hit rate. It keeps changing, so open the page for the current numbers.

### v2 (history): takes and builder fees

CallBook v2 `0x073C82774C9067347d236cA0bA78dD822C1791B7` is kept as history. These rows are still valid.

| What | Tx |
|---|---|
| v2 Reactivity subscription created (id 38487587) | [`0x99d52128...8787`](https://explorer.testnet.somnia.network/tokyo/tx/0x99d5212821a55bd2eb348882a9c1afad2556e730d8c29cc1c71d757c0a8b8787) |
| v2 follower take, builder-tagged fill (block 47023302) | [`0x13ef1b70...e69e`](https://explorer.testnet.somnia.network/tokyo/tx/0x13ef1b70d3187563f7cafdbdd526156d9424a406804ffe003facf8e138f0e69e) |
| v2 validator-run handler crediting the take, same block | [`0x7a680f04...f15c`](https://explorer.testnet.somnia.network/tokyo/tx/0x7a680f04be617a7f5616792b526a598adb7848db173639aaaa9c9707176ff15c) |
| Script-level loop: builder-tagged fill, caller paid 0.019193278 USDso (10 bps of about $19.19) | [`0x5cc71549...8fbc`](https://explorer.testnet.somnia.network/tokyo/tx/0x5cc715498e917e9848d903f9704df44050c5b07b5171df8ea00a606f42498fbc) |
| Caller withdrew that fee | [`0xb27ad347...8a99`](https://explorer.testnet.somnia.network/tokyo/tx/0xb27ad3473fca9328db1e3a0bd2d0b1ba6bf99963366414ffeb8bc22cc1048a99) |
| Follower via the web UI, fresh wallet: margin deposit | [`0xf13fba06...9f2e`](https://explorer.testnet.somnia.network/tokyo/tx/0xf13fba069906cf3e30e1fbb0548236bb4f13685d67a0fbf2d9445cd6b29c9f2e) |
| Same follower: take plus stop and target | [`0xaef14392...5121`](https://explorer.testnet.somnia.network/tokyo/tx/0xaef1439227be999b91ec2e5a717995dcf686f799cf7d0690f1e72de213515121) |
| Same follower: close, then cancel exits | [`0x47957ed3...7d57`](https://explorer.testnet.somnia.network/tokyo/tx/0x47957ed3aad57a1c4b861ddc191daf490a96d75eb16fe20cafe0c620537e7d57), [`0x314a3a1a...f7f5`](https://explorer.testnet.somnia.network/tokyo/tx/0x314a3a1a5e2c8c8ac8935daaba050ac7376c5c8d71b9c5e333ac7b2cb254f7f5) |
| Caller via the web UI: post a call | [`0xf278020f...4537`](https://explorer.testnet.somnia.network/tokyo/tx/0xf278020fba8352d60ddc246a46f53a000ad4b67ddd5842870fca5f1cfe944537) |
| Caller via the web UI: withdraw earnings | [`0xaed150ab...9c84`](https://explorer.testnet.somnia.network/tokyo/tx/0xaed150ab6a24d574c68687d6d8e0af30689c5076c0450eea12133d7f07249c84) |

## Why Somnia Reactivity matters here

Counting takes looked easy and wasn't. The dreamDEX indexer can't filter orders by the `userData` tag, and it doesn't index perp builder fees. The RPC limits `eth_getLogs` to about 1000 blocks. Any server-side attribution would have been a fragile scraper. Reactivity let the contract listen to the fee event itself, so the take is recorded in the same block as the fill, by the chain. The bond split depends on it: takers are paid by the fees the chain itself counted.

dreamDEX lists builder codes and fee rebates as roadmap item #2. Perp pools already allow a 10 bps builder fee on chain, and Callout uses it today. Perp builder fees are credited to the builder's MarginBank balance (withdraw with `withdrawMargin`), not the pool vault.

## How I tried to break it

| Input | Result |
|---|---|
| Caller closes the call early to dodge a stop | Doesn't work. A closed call can still be resolved until it expires |
| Price is stale when someone resolves | Reverts with `StalePrice`. Nothing is recorded |
| Price moved back before anyone resolved | Reverts with `NotResolvable`. Nothing changes |
| Taker claims the bond twice | Reverts |
| Someone who never took the call tries to claim | Nothing to claim |
| STOPPED with zero takers | Caller gets the bond back |
| Price feed is stale when a follower takes | Take is blocked. The app reads dreamDEX's on-chain mark (`getPerpState`), not the indexer snapshot, which sat stale for over an hour |
| Margin would liquidate before the stop | Margin is sized past the stop distance, the liquidation price is shown, and the take is blocked if the stop wouldn't fire first. An early UI version sized margin at the minimum and was caught in testing |
| dreamDEX practice-USDso voucher claim reverts for a plain wallet | The app simulates first and routes to a normal deposit instead of sending a failing tx |
| Tokyo RPC degraded (calls hung, "node not ready") | A failed read is shown as a failed read, not as "contract not configured". That masking bug was found on the profile page and fixed |
| Follower closes the position | Close has no builder tag, so it is not counted as a take |
| Someone who isn't the caller tries to close a call | Rejected by the contract |
| Caller tries to change a posted call | No edit function exists, and a test checks terms stay identical across time and close |
| Second open call by the same caller on the same market | Rejected: one open call per caller per market |

**A stale or missing price never settles a call.** The contract decides what counts, and the app blocks unsafe takes before they are sent.

Tests: `forge test` runs 57 passing, `vitest` runs 70 passing (take sizing, liquidation and stop checks, price handling, outcome logic).

## Quickstart

Easiest is the live app: https://callout-perps.vercel.app. You need a browser wallet on Somnia Tokyo testnet and a little STT from the [faucet](https://explorer.testnet.somnia.network/tokyo/faucet).

To run it locally:

```bash
git clone https://github.com/Techkeyy/callout
cd callout/web
npm install

cp .env.example .env.local
# set in .env.local:
# NEXT_PUBLIC_CALLBOOK_ADDRESS=0x7D9F2b0c5257Ac2fe12f07713971a530B389365c
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
| `contracts/src/CallBook.sol` | Immutable call record, bond, resolve and settle, take ledger, Reactivity handler for `BuilderFeeCharged` |
| `web/src/lib/take.ts` | Sizes margin past the stop, computes liquidation, gates unsafe takes |
| `web/src/lib/outcome.ts` | Decides HIT, STOPPED or EXPIRED from the mark price and the call's levels |
| `web/src/lib/board.ts` | Builds the leaderboard from callers' on-chain records |
| `web/src/lib/dex.ts` | dreamDEX perp calls: deposit, approve, tagged `placeOrder`, stop and target, close |
| `web/src/lib/mark.ts`, `prices.ts` | Live on-chain mark price and stale checks |
| `web/src/lib/callbook.ts`, `calls.ts` | Reads calls, records and the take ledger from CallBook |
| `web/src/lib/wallet.tsx` | Injected-wallet provider, no wagmi |
| `web/src/components/Composer.tsx` | Write and post a call with its bond |
| `web/src/components/TakePanel.tsx` | Follower flow on a call card |
| `web/src/components/ResolveClaim.tsx` | "Record on chain" and bond claim |
| `web/src/components/Earnings.tsx` | Caller earnings and withdraw |
| `web/src/app/c/[id]` | Call card page and share image |
| `web/src/app/board` | Leaderboard ranked by hit rate |
| `web/scripts/keeper.ts` | Resolves calls automatically when the price passes a level; scheduled by `.github/workflows/keeper.yml` |

Stack: Next.js 16, viem, `@somnia-chain/markets-sdk` 0.33, Solidity 0.8.30 with Foundry, Somnia Reactivity, Vercel.

## Limits

- Testnet only, paper USDso. No real funds.
- An outcome is recorded only when someone resolves while the price is past the level. A brief touch that nobody catches won't count. The 10-minute keeper narrows that gap but can't close it.
- dreamDEX's practice-USDso voucher claim reverts for some plain wallets. The app checks first and routes to deposit.
- Prices come from dreamDEX's on-chain mark. If it is stale, takes are blocked and resolves revert.
- One open call per caller per market.
- Each CallBook version holds its own Reactivity subscription, funded with STT held by the contract. It pays handler gas and can't be withdrawn.

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
