# SDK: `loadMarkets().info.markPrice` is a stale indexer snapshot, not the live mark
Severity: normal
Area: SDK / API

## Steps to reproduce
1. On Hideki (chain 50383), with `@somnia-chain/markets-sdk@0.33.0`, call `exchange.loadMarkets(true)` and read `info.markPrice` for the BTC perp.
2. In the same second, read `exchange.client.getPerpState(pool).markPrice` for the same pool.

## Expected
`markPrice` from `loadMarkets` matches the on-chain mark, or is documented as a cached indexer value with its timestamp.

## Actual
One run on 2026-11-11, seconds apart:
```
loadMarkets markPrice   73634045092525887500000
getPerpState markPrice  73942517759944545000000   markPriceOk: true
```
That's a 0.42% gap, about $308 on BTC. The value has no `asOf` field, and `force=true` on `loadMarkets` doesn't refresh it.

## Impact
Anything that checks a stop or target against this mark gets the wrong answer near the level. Callout first used it to label calls as HIT or STOPPED and to size stop-safe margin, and showed an outcome the contract would reject. We moved to `getPerpState` (or the pool's `tryGetMarkPrice()`) and use `markPriceOk`.

## Suggestion
Document `info.markPrice` as an indexer snapshot and add its block or time, or read it from `getPerpState` in `loadMarkets`.
