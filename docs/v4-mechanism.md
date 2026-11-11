# CallBook v4: the mechanism, written before the code

v3 made callers post a bond. An outside review found that the bond only punished one way of being wrong, and our own stress test then found two more holes. This file is the spec v4 is built and tested against: every terminal state, every cheap dodge, and the rule that closes it.

## Why v4

| Gap in v3 | Found by | v4 rule |
|---|---|---|
| An expired call returned the full bond, so the cheapest strategy was a wide stop and a far target: never stopped, never hit, fees kept. | outside review | Expiry settles against the live price. The bond is forfeited in proportion to how far the price moved toward the stop. |
| `resolve` checked the clock before the price, so a stopped call resolved late counted as expired. | outside review | Price is always read first. At expiry, past the stop is STOPPED and past the target is HIT. |
| A flat 5 USDso bond against fees that grow with followers. | outside review | The caller declares a follower capacity (notional), and the bond must be at least 2% of it. Takes past the capacity are not covered. |
| No reentrancy guard on `claim`. | outside review | `nonReentrant` on every state-changing entry point. Transfers were already checked for success. |
| The entry was never checked against the market, so a caller could post a target the price had already passed and record an instant HIT. | our stress test | At post, the mark must sit strictly between the stop and the target, and the entry must be within 0.5% of the mark. |
| `pool` could be any address, including a fake contract that reports any price, so hits could be farmed off-market. | our stress test | The pool must be registered on dreamDEX's MarginBank (`isPerpPoolRegistered`). |
| A late resolve after expiry read the price whenever someone got around to it. | our stress test | Every call asks Somnia Reactivity for a callback at its own expiry. On testnet that callback was not observed to fire, so a keeper resolves expired calls within about 2 minutes, `claim` settles first, and anyone can resolve. |

## Rules at post

- The pool is registered on MarginBank, and its mark price is readable.
- Long: `stop < mark < target`, `stop < entry < target`. Short is the mirror.
- `|entry - mark| <= 0.5%` of the mark.
- The stop distance is between 0.1% and 10% of entry.
- The target distance is at least the stop distance (reward-to-risk of at least 1).
- `capacity > 0`, `bond >= minBond` and `bond >= 2% of capacity`.
- One open call per caller per market. This is not only anti-spam: takes are matched to calls by (caller, market) from dreamDEX's builder-fee event, so two open calls on one market could not be told apart. It also blocks the hedge of posting a long and a short at once.

## Resolution, in order

1. Already resolved: revert.
2. Read the mark. Unreadable: revert (or, inside the expiry callback, leave it for a manual resolve).
3. Before expiry: past the target is HIT, past the stop is STOPPED, otherwise not resolvable.
4. At or after expiry: past the stop is STOPPED, past the target is HIT, otherwise EXPIRED with `forfeit = bond * adverse / stopDistance`, where `adverse` is how far the mark sits beyond the entry on the losing side (0 if the call is in profit).

## Payoff table

"Covered" means notional inside the declared capacity. Each taker's share is their covered notional divided by the total covered notional.

| Terminal state | Caller | Takers | Record |
|---|---|---|---|
| HIT (before or at expiry) | whole bond back | nothing from the bond; their trade hit its target | hit |
| STOPPED (before or at expiry) | nothing | whole bond, by covered share | stop (a miss) |
| EXPIRED, price on the winning side of entry | whole bond back | nothing from the bond | expired, not a miss |
| EXPIRED, price on the losing side of entry | `bond - forfeit` | `forfeit`, by covered share | expired loss (a miss) |
| Any outcome, nobody took the call | whole bond back | nothing | as above |
| Never resolved | the keeper resolves it within about 2 minutes; anyone can resolve, and `claim` resolves first | same | same |
| Over-capacity fill | earns the dreamDEX fee (paid at fill; no contract can stop that) | not covered by the bond; the app blocks it | not counted |

Hit rate is `hits / (hits + stops + expired losses)`, so the money and the leaderboard judge every outcome the same way.

## Dodges, and what closes each

| Dodge | Closed by |
|---|---|
| Wide stop, far target, wait for expiry | The 10% stop cap, plus settlement at expiry |
| Post a target the price has already passed | The mark must sit between the levels at post |
| Point the call at a fake market | The MarginBank registry check |
| Resolve late, at a moment that suits you | The keeper settles expired calls within about 2 minutes; the window is small and disclosed |
| Post a long and a short at once | One open call per caller per market |
| Tiny capacity, then attract big followers | Over-capacity takes are not covered and the app blocks them; the fee on fills placed outside the app is a disclosed limit |
| One-tick levels as a coin flip | The minimum 0.1% stop and reward-to-risk of at least 1 |
| New wallet to wash a bad record | Every call is bonded; a fresh wallet starts with an empty record, which the board shows |

## Known limits, stated plainly

- **A touch between checks is missed before expiry.** If the price crosses a level and comes back before anyone resolves, the record never sees it. The keeper runs every 2 minutes, and anyone can press "Record on chain".
- **dreamDEX pays the builder fee at fill time.** No contract can withhold it, so the bond is how the net result is made conditional.
- **Testnet.** Paper USDso, no real audience yet.
- **The steward key.** One immutable address can withdraw the contract's native STT reserve (the 32 STT Somnia requires for subscriptions), so an upgrade does not strand it. It cannot touch bonds, calls or outcomes.
