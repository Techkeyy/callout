# SDK: `trader.placeOrder` on a perp pool fails in preflight with `marketExpiryNs reverted`
Severity: normal
Area: SDK

## Steps to reproduce
1. Install `@somnia-chain/markets-sdk@0.33.0` and create a `SomniaMarkets` exchange for Hideki (chain 50383) with any private key. The key does not need funds: the call fails before anything is broadcast.
2. Call the generic binary-style order method on a perp pool, the BTC perp pool `0x4181dd08e73bbcdd1ba3e615a18f6abd941b94c0`:
```ts
const trader = exchange.trader;
await trader.placeOrder({ pool: "0x4181dd08e73bbcdd1ba3e615a18f6abd941b94c0", side: "BUY_YES", price: 1000000000000000000n, quantity: 1000000000000000n });
```
3. Observe the error. For comparison, the PerpPool's `marketExpiryNs()` is also read directly with `eth_call` on the same pool.

Repro: `new SomniaMarkets({ chain, indexerUrl, wsRpcUrl, addresses: SOMNIA_HIDEKI_TESTNET_ADDRESSES, privateKey })`, then `exchange.trader.placeOrder(...)` as above.

## Expected
Either the order is placed through the perp pool, as `placePerpOrder` does, or the SDK throws a clear error that says perp pools must use `placePerpOrder`. `placeOrder` should not run binary-market preflight on a perp pool.

## Actual
```
@somnia-chain/markets-sdk: marketExpiryNs reverted: The contract function "marketExpiryNs" reverted.
```
The error names a contract function that does not exist on the perp pool. The SDK reads `marketExpiryNs(pool)` in `binaryOrderCall` (dist/orders.js, around line 1095) before it builds the transaction. The direct read on the perp pool also reverts:
```
{"jsonrpc":"2.0","id":1,"error":{"code":3,"message":"execution reverted","data":"0x"}}
```
So the SDK treats a perp pool as a binary market, and the user sees a revert from an unrelated function.

## Evidence
- Preflight error above, reproduced on 2026-11-11 with a throwaway unfunded key. No transaction was sent.
- Direct `eth_call` of `marketExpiryNs()` on `0x4181dd08e73bbcdd1ba3e615a18f6abd941b94c0` against `https://api.hideki2.infra.testnet.somnia.network`: `execution reverted`.
- Working perp order on the same pool, sent by the follower wallet, for comparison: [0xd664cc3a6b28b24dbde1af26efc665640150a1b4ea4fe26450fa355c386904d3](https://explorer.testnet.somnia.network/tokyo/tx/0xd664cc3a6b28b24dbde1af26efc665640150a1b4ea4fe26450fa355c386904d3) (raw call to the PerpPool's `placeOrder(bool isBid, uint64 userData, ...)`, not via the SDK).

## Environment
- SDK: `@somnia-chain/markets-sdk` 0.33.0 (`new SomniaMarkets(...)`, method `trader.placeOrder`)
- Network: Somnia Tokyo testnet (Hideki, chain 50383)
- Wallet: throwaway unfunded key for the repro; the perp order in Evidence was sent by 0x5Eb1893EE7522309FC2f9b73588c245B03d345FF
