# CallBook v4: pre-deploy security pass

Run with the critical-bug-hunter skill (phases 3, 7, 8, 10, 15, 16) on the v4 contract diff, before deployment. 58 forge tests back the findings.

## State machine

Each call is OPEN, then exactly one terminal state: HIT, STOPPED or EXPIRED. There are three ways in, and all of them run the same `_settle`:

| Trigger | Who | On failure |
|---|---|---|
| `resolve(id)` | anyone | reverts (StalePrice, NotResolvable) |
| Schedule callback at expiry | the Somnia chain | no revert; the call stays OPEN for a manual resolve |
| `claim(id)` while OPEN | any participant | reverts NotClaimable |

No terminal state can change. A claim happens once per address and never pays out more than the bond (fuzzed).

## Findings

| # | Severity | Finding | Status |
|---|---|---|---|
| A1 | P1 (unverifiable in tests) | The schedule callback relies on `tx.origin == address(this)` and on the block timestamp at firing being at least `expiresAt`, as the builder-fee callbacks already do in v3. The mocks cannot prove the real precompile behaves the same for `Schedule` events. | Verify on chain after deploy: post a short-lived call and confirm the chain settles it without a manual resolve. If it does not, manual resolution still works, and the README must say so. |
| A2 | P2 | Self-take crowding: a caller fills their own capacity from sock wallets so real followers are uncovered, and the bond on a stop returns to the socks. | Not profitable. Real followers past capacity are blocked in the app, so the caller earns real fees only on the share real takers cover, and loses the bond on that same share. The penalty-to-reward ratio is unchanged. |
| A3 | P2 | After expiry, a manual resolve settles at the price at that moment, not at expiry, if the schedule did not land. | Disclosed in docs/v4-mechanism.md. The schedule and the 2-minute keeper narrow it. |
| A4 | P3 | Rounding dust stays in the contract. There is no sweep, on purpose: the steward cannot touch tokens. | Accepted. Bounded by the number of claimants per call (tested). |
| A5 | P3 | A take with zero covered notional still counts toward `takers`. | Accepted. The app shows covered notional next to the count. |
| A6 | Info | The steward can withdraw the STT reserve below 32 STT, which stops subscriptions. | Disclosed. The steward has no power over bonds, calls or outcomes (tested). |

## Value flow

The bond is pulled at post and held until a claim. HIT pays the caller the bond. STOPPED pays the takers the bond, by covered share. EXPIRED pays the takers the forfeit and the caller `bond - forfeit`. With no covered takers, the caller is paid the bond. The sum of claims is at most the bond (fuzz `testFuzz_expiredForfeitBounded`, `test_claim_neverPaysMoreThanBond`).

## Security checks

- **Reentrancy:** `nonReentrant` on `post`, `resolve`, `claim` and `withdrawReserve`. A hooked token that re-enters `claim` from inside the payout is rejected (`test_reentrancy_claimCannotReenter`).
- **Transfers:** both directions check the call result and any returned bool (`test_transferReturningFalseReverts`).
- **Arbitrary market:** only pools registered on dreamDEX's MarginBank are accepted (`test_revert_poolNotRegistered`).
- **Callbacks:** only the precompile can call `onEvent`; the wrong emitter or the wrong `tx.origin` is ignored (`test_takesIgnoredFromWrongSender`, `test_scheduleFromWrongEmitterIgnored`).
- **Mark price:** read with a static call, so a failing or misbehaving pool means "stale", never a revert inside a callback.

## What could still pass every test (blind spots)

1. The real precompile's `Schedule` semantics (A1).
2. The real fee-to-notional ratio. The tests assume dreamDEX's 10 bps builder fee means notional = fee × 1000. Check it against a real fill after deploy.
3. Mark-price units for pools with other decimals. Every market the app lists uses 18-decimal quote units, as v3 did.
4. Gas for `post` on Somnia now includes a ~210k-gas subscription. The app pads the node's estimate by 2x, and this must be checked on chain.
5. Builder-fee events from fills placed outside the app. They are credited to the open call, as in v3, by design.
