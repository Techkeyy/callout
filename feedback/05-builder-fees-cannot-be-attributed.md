# Builder fees: perp `BuilderFeeCharged` carries no order reference, and the indexer's `BuilderFeeRecord` stays empty, so a builder cannot tell which order earned a fee
Severity: major (for builders)
Area: contracts / API

## Steps to reproduce
1. Place a tagged perp order through a builder on Hideki (chain 50383): `PerpPool.placeOrder(..., userData, ..., builder, builderFeeBpsTimes1k)`. Here the follower `0x5Eb1…45FF` takes Callout call #5 on the BTC perp pool `0x4181dd08e73bbcdd1ba3e615a18f6abd941b94c0`, with builder `0x8284…0d58` (the caller) and `userData = (0xCA11 << 48) | 5`.
2. Decode the logs of that transaction ([0x0cea674e…5c3f](https://explorer.testnet.somnia.network/tokyo/tx/0x0cea674ec5dd36b7b1271a83ce5d8c3f43fbd40d62bcc1e6448d442a236f5c3f)) with the SDK's `marginBankEventsAbi` and `orderBookEventsAbi`:
   ```sh
   cd web && node --experimental-strip-types scripts/probe-fee-logs.ts 0x0cea674ec5dd36b7b1271a83ce5d8c3f43fbd40d62bcc1e6448d442a236f5c3f
   ```
3. Ask the indexer for the builder's fee records with the SDK (`@somnia-chain/markets-sdk` 0.33.0):
   ```ts
   await exchange.client.listBuilderFees({ builder: "0x8284489d1b7e995544d945e732e0801df9680d58" });
   await exchange.client.listBuilderFees({}); // any builder
   ```
   Repro: `node --experimental-strip-types scripts/probe-builder-fees.ts`.

## Expected
- A builder can tie each fee to the order that paid it, either on chain (the fee event names the order or its `userData`) or through the indexer's `BuilderFeeRecord`, whose SDK type already has `orderId`, `builder`, `payer` and `pool`.
- A contract that listens to the fee event (for example with Somnia Reactivity) can attribute the fee without a second source.

## Actual
- The MarginBank emits `BuilderFeeCharged(address indexed payer, address indexed builder, address indexed perpPool, uint256 amount)`. It has no order ID and no `userData`. The tag sits only in `OrderPlaced.placedOrder.userData`, a separate event from a different contract:
  ```
  0x478769e1 BuilderFeeCharged {"payer":"0x5Eb1…45FF","builder":"0x8284…0d58","perpPool":"0x4181…94C0","amount":"25016996000000000"}
  0x4181dd08 OrderFilled       {"takerOrderId":"16989451291886508713028", ... "fillPrice":"73579400000000000000000"}
  0x4181dd08 OrderPlaced       {"orderId":"16989451291886508713028","placedOrder":{"owner":"0x5Eb1…45FF","userData":"14560419070265524229", ...}}
  ```
- `listBuilderFees` returns **0 records**, both for this builder and with no filter at all, although this builder has earned perp builder fees on several fills (this one included: 0.025016996 USDso). Observed on 2026-11-12.

## Why it matters
Builder codes and fee rebates are item #2 on the dreamDEX roadmap. Today a perp builder that routes orders for many sources (creators, strategies, referrers) cannot see which source earned a fee:
- On chain, a listener gets payer, builder, pool and amount, and nothing that links back to the order.
- Off chain, the indexer entity meant for this is empty.

Callout works around it by matching each fee to a call by (payer's chosen builder, pool). That forces a product rule of one open call per caller per market. Joining by transaction hash off chain would work for a server, but not for an on-chain consumer.

## Suggested fix
- Add `orderId` (and ideally `userData`) to `BuilderFeeCharged`, or emit a companion event, so on-chain listeners can attribute fees directly.
- Index perp `BuilderFeeCharged` into `BuilderFeeRecord` with `orderId` filled, so `listBuilderFees` works for perps.

## Environment
- SDK: `@somnia-chain/markets-sdk` 0.33.0
- Network: Somnia Tokyo testnet (Hideki, chain 50383). MarginBank `0x478769E1177C0773c43A593DCCc4Ad15F15F1394`, BTC perp pool `0x4181dd08e73bbcdd1ba3e615a18f6abd941b94c0`
- Wallets: payer 0x5Eb1893EE7522309FC2f9b73588c245B03d345FF, builder 0x8284489d1B7E995544D945E732E0801df9680d58
- Consumer: CallBook v4.1 `0xc83b954b22003dbe498c47b2330699466c79661d`, whose Reactivity handler for this fee ran in [0x9a67181b…ad5a](https://explorer.testnet.somnia.network/tokyo/tx/0x9a67181bc90468ebbcfe5f9dbb8bb8aacd74d971c23b905824525d5162c1ad5a)
