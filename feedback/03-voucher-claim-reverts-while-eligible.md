# Perp voucher: `claim()` reverts with unknown error `0x3e31dcc2` while `getPerpVoucherEligibility` says eligible
Severity: normal
Area: SDK / contracts

## Steps to reproduce
1. With `@somnia-chain/markets-sdk@0.33.0` on Hideki (chain 50383), check a plain EOA:
```ts
await exchange.client.getPerpVoucherEligibility("0x478769E1177C0773c43A593DCCc4Ad15F15F1394", account);
// {"eligible":true,"grantAmount":"1000000000000000000000"}
```
The campaign is live: `getPerpVoucherCampaign` returns distributor `0x2ACD9EFdA721450906bfE1bef3edE269636E42C4`, `claimsRemaining` 70779, `endsAt` 1798477478.
2. Build the claim with `exchange.trader.buildClaimPerpVoucher({ marginBank })`. It returns `claim()` (selector `0x4e71d92d`) on the distributor.
3. Simulate it with `eth_call` from the same account, or send it.

## Expected
Either the claim succeeds, or eligibility returns `false` with a reason, so an app can decide whether to offer the voucher.

## Actual
- The sent claim reverts: tx `0x400537290623817ffbbf511965b270036eced6e3475feaf904885f2f553f3187`, revert data `0x3e31dcc2`.
- `0x3e31dcc2` is not in any ABI shipped with the SDK, so the SDK can't decode it ("Execution reverted for an unknown reason").
- Re-checked on 2026-11-11 with the tester account `0x8284489d1B7E995544D945E732E0801df9680d58`: eligibility still says `true`, and the simulated `claim()` still reverts.

## Impact
An app that trusts `getPerpVoucherEligibility` offers new traders a 1000 USDso voucher that can't be claimed. Callout now simulates `claim()` first and only shows the voucher when the simulation passes.

## Suggestion
Make eligibility check the same conditions as `claim()`, and ship the distributor's custom errors in the SDK ABI so the revert decodes.
