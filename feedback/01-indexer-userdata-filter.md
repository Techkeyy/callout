# Indexer: `userData` `_eq` filter returns "database query error" unless the query is also scoped to an owner
Severity: normal
Area: API

## Steps to reproduce
1. Filter `Order` on `userData` alone with an equality match, for a multi-digit tag:
```sh
curl -s https://hideki-dev.smk.somnia.host/v1/graphql -H 'content-type: application/json' \
  -d '{"query":"{ Order(where:{userData:{_eq:\"12\"}}, limit:2) { userData } }"}'
```
2. Same with the tag from the real order: `{ Order(where:{userData:{_eq:\"14560419070265524225\"}}, limit:1) { userData } }`.
3. Same with a numeric literal: `{ Order(where:{userData:{_eq:100}}, limit:1) { userData } }`.
4. Control: `_neq` on the same field, unscoped: `{ Order(where:{userData:{_neq:\"0\"}}, limit:2) { userData } }`.
5. Control: the same `_eq` combined with an owner filter: `{ Order(where:{owner:{_eq:\"0x5eb1893ee7522309fc2f9b73588c245b03d345ff\"}, userData:{_eq:\"14560419070265524225\"}}, limit:2) { userData } }`.

## Expected
Step 1 to 3 return the orders whose `userData` equals the value, as they do for `_eq` on `"4"`, `"1"`, `"2"` and `"0"` (verified working on the same endpoint).

## Actual
Steps 1 to 3 return a generic error and no rows:
```
{"errors":[{"message":"database query error","extensions":{"path":"$","code":"unexpected"}}]}
```
Observed on 2026-11-11 for every multi-digit value tested (12, 100, 65536, 2147483647, 2147483648, 4294967296, 1000000000000000000, 14560419070265524225). Single-digit `_eq` (1, 2, 4) works unscoped. Steps 4 and 5 succeed: `_neq` returns rows, and `_eq` returns the tagged rows when an owner filter is present. So the failure is specific to an unscoped `_eq` on `userData` with a multi-digit value.

The SDK's `OrdersOptions.userData` builds the same `userData: {_eq}` term, always alongside `owner: {_eq}`, so the SDK path works. The bug affects queries that look up orders by tag across all owners, which is the case the docs describe.

## Evidence
- Tagged order, placed by the follower wallet on the ETH perp pool `0x4181dd08e73bbcdd1ba3e615a18f6abd941b94c0` (not on the builder's own account):
  `userData: 14560419070265524225`, status `Filled`, placed tx [0xd664cc3a6b28b24dbde1af26efc665640150a1b4ea4fe26450fa355c386904d3](https://explorer.testnet.somnia.network/tokyo/tx/0xd664cc3a6b28b24dbde1af26efc665640150a1b4ea4fe26450fa355c386904d3). A second tagged order, [0x13ef1b70d3187563f7cafdbdd526156d9424a406804ffe003facf8e138f0e69e](https://explorer.testnet.somnia.network/tokyo/tx/0x13ef1b70d3187563f7cafdbdd526156d9424a406804ffe003facf8e138f0e69e), has the same tag.
- Request in step 2 and response:
```
{"errors":[{"message":"database query error","extensions":{"path":"$","code":"unexpected"}}]}
```
- Request in step 4 and response (control):
```
{"data":{"Order":[{"userData":"1"}, {"userData":"1"}]}}
```
- Request in step 5 and response (control, owner-scoped):
```
{"data":{"Order":[{"userData":"14560419070265524225"}, {"userData":"14560419070265524225"}]}}
```

## Environment
- SDK: `@somnia-chain/markets-sdk` 0.33.0
- Network: Somnia Tokyo testnet (Hideki, chain 50383), indexer `https://hideki-dev.smk.somnia.host/v1/graphql`
- Wallet: 0x5Eb1893EE7522309FC2f9b73588c245B03d345FF (follower, placed the tagged orders); builder 0xa660487cA7Be8B292a8271371419211ec21b002b
