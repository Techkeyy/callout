# Callout feedback (dreamDEX Perps Builder Bounty, Feedback track)

Reproduced on Somnia Tokyo testnet (Hideki, chain 50383), `@somnia-chain/markets-sdk` 0.33.0, on 2026-11-11 and 2026-11-12.

| # | Title | Severity | Area |
|---|-------|----------|------|
| 01 | [Indexer: `userData` `_eq` filter returns "database query error" unless the query is also scoped to an owner](01-indexer-userdata-filter.md) | normal | API |
| 02 | [SDK: `trader.placeOrder` on a perp pool fails in preflight with `marketExpiryNs reverted`](02-sdk-placeorder-on-perp-pool-marketexpiryns.md) | normal | SDK |
| 03 | [Perp voucher: `claim()` reverts with unknown error `0x3e31dcc2` while eligibility says eligible](03-voucher-claim-reverts-while-eligible.md) | normal | SDK / contracts |
| 04 | [SDK: `loadMarkets().info.markPrice` is a stale indexer snapshot, not the live mark](04-loadmarkets-stale-markprice.md) | normal | SDK / API |
| 05 | [Builder fees: perp `BuilderFeeCharged` carries no order reference, and the indexer's `BuilderFeeRecord` stays empty](05-builder-fees-cannot-be-attributed.md) | major | contracts / API |
| 06 | [Builder approval is keyed to (pool, fee recipient): users must approve every creator on every market](06-builder-approval-per-pool-per-recipient.md) | normal | contracts / UX |
