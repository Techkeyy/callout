# Callout: director log

Hand-off file. Any director picking this up reads this first. Keep it current.

## Facts

- **Hackathon:** dreamDEX Perps Builder Bounty (DoraHacks), MVP track, 3 x $500.
- **Deadline:** 2026-11-15 15:30 UTC+1 = **14:30 UTC**.
- **Gates:** public GitHub repo; places real perps orders on Somnia Tokyo testnet (Hideki, chain 50383); README says what, who, how to run; README has 2 or 3 X posts tagging @DreamDEXSomnia. Submitting needs a whitelisted email: owner confirmed WHITELISTED on 2026-11-11.
- **Rubric (unweighted):** MVP potential (user value, credible scope, viral or repeat loop, execution); evidence of building (live testnet orders, tx hashes, repo, demo); communication (X posts). Somnia primitives (Reactivity, Agents) are a plus.
- **Owner rules:** Claude directs, Sonnet and Haiku sub-agents build. Never add Claude as a co-author on GitHub (overrides the default commit trailer). Commit at checkpoints without asking, after a secret scan. Skills live in `C:\Users\HomePC\Desktop\skill` (master director skill, design-skill, build-process, perfect-readme, audit-skill, demo-video, project-edge).
- **Research:** `C:\Users\HomePC\Desktop\skill\idea-research\dreamdex-perps-idea-research.md`.

## Product

- **PRODUCT:** Callout
- **INTENDED USER:** a crypto trader who posts trade calls on X for free (caller), and the people who follow them and copy by hand, late (followers).
- **CORE PROBLEM:** callers earn nothing from calls and can rewrite history; followers copy late, without stops, and can't check a record.
- **CORE PROMISE:** post a call once, as a card. Anyone can take it in one flow on dreamDEX with the stop and target already set. The caller earns the builder fee on every fill, and the call can never be edited.
- **REAL USER JOURNEY:**
  1. Caller opens Callout, connects a wallet, writes a call (market, long or short, entry, stop, target).
  2. Caller posts it (one transaction: the call is written on chain and can't be changed), gets a link and a card image, shares it on X.
  3. Follower opens the link, sees the call, the caller's record, and live price.
  4. Follower connects, picks a size, takes the call: setup if needed (gas, paper USDso, margin), approve this caller once, order fills, TP and SL armed.
  5. The card shows the take: takers, size, followers' P&L.
  6. Caller sees earnings grow and withdraws them.
  7. Follower can close the position early from the card.
- **FINAL OUTCOME:** follower holds a real position with exits set; caller holds withdrawn builder fees.

**Core Outcome:** Callout is only genuinely working when a follower who opened a caller's card ends up with a filled dreamDEX perp position carrying the call's stop and target, and the caller's builder balance grows by that fill's fee and the caller withdraws it, all through the deployed app.

## Status

`BUILDING â€” CORE PATH NOT YET PROVEN`

## Protocol facts (verified)

- Chain: Hideki 50383, RPC `https://api.hideki2.infra.testnet.somnia.network`, WS `wss://api.hideki2.infra.testnet.somnia.network/ws`, indexer `https://hideki-dev.smk.somnia.host/v1/graphql`, explorer `https://explorer.testnet.somnia.network/tokyo`, STT faucet `https://explorer.testnet.somnia.network/tokyo/faucet` (1 STT to any address under 1 STT).
- SDK `@somnia-chain/markets-sdk` 0.33.0. Markets: `loadMarkets(reload)` filter `type === "swap"`. BTC pool `0x4181dd08e73bbcdd1ba3e615a18f6abd941b94c0`, base decimals 8, tick 0.1, minQuantity 13000 raw.
- Builder fee on perps: trader `approveBuilder({pool, builder, maxFeeBpsTimes1k})`, then `placeOrder`/`placePerpOrder` with `builder`, `builderFeeBpsTimes1k` (cap 10000 = 10 bps). `PlaceOrderParams` also has `userData` (uint64 tag, stored on the order, indexer-filterable) = card tag `(0xCA11 << 48) | cardId`. **Perp builder fees are credited by MarginBank** (`BuilderFeeCharged(payer, builder, perpPool, amount)`), NOT the pool vault (pool `getWithdrawableBalance` reverts). Caller reads `getMarginAccount(marginBank, caller).withdrawable` and withdraws with `withdrawMargin`. Indexer table `BuilderFeeRecord {builder payer amount token txHash pool}`.
- Stops: `placePerpStopOrder` with per-market `stopRegistry`, operatorRegistry `0x6B2FbfeD328FF5F20C0BE7D3C3437613aFFE8D3a`, quantity 0 = whole position, linked TP/SL pair, 0.15 STT locked per leg (refunded on cancel).
- SDK accepts a viem `walletClient` for browser signing.
- Reference code: github.com/somnia-chain/dreamdex-bot-kit `packages/perp-core/src/{orders,stops,margin,markets}.ts`.

## Spike

**CORE MONEY LOOP PROVEN ON TESTNET (script level, 2026-11-11):** follower deposit `0x8fc20d8eâ€¦19a8`, approveBuilder `0x3b7dede4â€¦83e7`, builder-tagged IOC long 0.00026 BTC filled `0x5cc71549â€¦8fbc`, TP/SL bracket `0xabdb54ffâ€¦a70`, caller margin +0.019193278 USDso (= 10 bps of ~$19.19 notional), caller `withdrawMargin` `0xb27ad347â€¦a99`, caller wallet 50 â†’ 50.019193278 USDso. Card tag via raw `perpPoolWriteAbi.placeOrder(isBid, userData, price, qty, expireNs, orderType, selfMatch, builder, feeBpsTimes1k)` works: `0xd664cc3aâ€¦04d3`, indexer Order.userData = 14560419070265524225 (0xCA11<<48|1), status Filled.

Gotchas found (also Feedback-track candidates, check dupes first):
- SDK market `info` values (markPrice, tickSize, minQuantity) are raw units, not decimals.
- Generic `trader.placeOrder` on a perp pool reverts in the SDK (`marketExpiryNs reverted`): it treats the pool as a binary market. `placePerpOrder` has no `userData`. Raw ABI call needed for tagging.
- Indexer: any filter on `Order.userData` returns "database query error". `BuilderFeeRecord` stays empty for perp builder fees (MarginBank event not indexed).
- RPC `eth_getLogs` range is limited to ~1000 blocks.
- Docs list `client.listPerpMarkets()`, which doesn't exist; use `loadMarkets` + type "swap".

**Decision: takes are attributed on chain with Somnia Reactivity.** CallBook subscribes (once, `watch()`, needs â‰¥32 STT held by the contract) to MarginBank `BuilderFeeCharged`; its handler credits the fill to the builder's single open call on that pool (rule: one open call per caller per market). No DB, no indexer. Closes from the app carry no builder tag, so they aren't counted as takes.

Disk: C: was full on 2026-11-11 (0 bytes). With owner approval, deleted broken `web/node_modules`, `~/.cache/codex-runtimes`, `~/.cache/solana`, which left 4.3 GB free. Watch disk use.

`spike/prove.mjs` (keys in gitignored `spike/.env`): caller `0xa660487cA7Be8B292a8271371419211ec21b002b`, follower `0x5Eb1893EE7522309FC2f9b73588c245B03d345FF`. Steps: `node prove.mjs follow` (voucher, approve, tagged IOC buy, bracket), `node prove.mjs earn`, `node prove.mjs withdraw`. Waiting on STT (owner is funding from the faucet).

## Deployed (Somnia Tokyo testnet, 50383)

- **CallBook v2:** `0x073C82774C9067347d236cA0bA78dD822C1791B7` (deploy tx `0xacb2b5ce…4530`, 21M gas). Funded 33 STT; `watch()` tx `0x99d52128…8787`; Reactivity subscription id 38487587 on MarginBank `BuilderFeeCharged`.
- **Reactivity proven on chain:** call #1 posted by caller (`0xcb149fd2…57d2`, 2.36M gas); follower took it with builder tag (`0x13ef1b70…e69e`, block 47023302); validator-run handler tx `0x7a680f04…f15c` in the SAME block; `getTakes(1)` = fills 1, takers 1, fees 0.009582339 USDso.
- Gas on Somnia: forge's local estimate is far too low for deploys (1.8M estimated vs 21M used). Use the RPC's `eth_estimateGas` (it was right for `post`: 3.54M estimate, 2.36M used) and pad 1.5-2x.

## Production

- **Live:** https://callout-perps.vercel.app (Vercel project `techkeyys-projects/callout`, root `web/`, linked in `web/.vercel`). Also https://callout-wine.vercel.app. Env: `NEXT_PUBLIC_CALLBOOK_ADDRESS` set at build and runtime. Owner approved production deploys and redeploys (2026-11-11).
- Redeploy: `cd web && vercel deploy --prod --yes --build-env NEXT_PUBLIC_CALLBOOK_ADDRESS=0x073C82774C9067347d236cA0bA78dD822C1791B7 --env NEXT_PUBLIC_CALLBOOK_ADDRESS=0x073C82774C9067347d236cA0bA78dD822C1791B7`

## UI test harness (test-only, not shipped)

`spike/signer.mjs` is a local stand-in wallet (POST JSON-RPC; signs with CALLER/FOLLOWER/TESTER key from `spike/.env`). Start with preview_start `signer-tester` (:8546) or `signer-caller` (:8547), then in the browser pane inject `window.ethereum = { request: a => fetch("http://localhost:8546", ...) }` on a localhost:3111 page. Tester wallet `0x8284489d1B7E995544D945E732E0801df9680d58` is the fresh-user test account.

UI test log, 2026-11-11, tester on /c/1 (local dev):
- connect OK; 0 STT shows the gas notice with faucet, copy and check-again (PASS)
- after 1 STT arrived, it auto-advanced (PASS)
- **BUG:** "Add margin" auto-passed with 0 margin because qty was clamped to maxQuantity = 0. Sent to the builder.
- Approve caller via UI tx `0xcf8aa2aa…c366` (PASS)

## Builders

| Pass | Model | Area | Status |
| --- | --- | --- | --- |
| CallBook v1 | Sonnet | `contracts/` | Done, 19 tests pass (re-run by director). Not deployed |
| CallBook v2 (Reactivity take ledger, one open call per market) | Sonnet | `contracts/` | Running |
| Web shell + design | Sonnet | `web/` | Done, commit 346c0fb. Reviewed by director in browser: composer, /c/1 with live ladder and on-chain take counters, OG image, /u page. No wagmi (own injected-wallet provider `lib/wallet.tsx`). Known bug: Ladder hydration mismatch (fix in pass 2) |
| Pass 2: take flow, close, earnings/withdraw, take-e2e script | Sonnet | `web/` | Running |
| Feedback-track reports | Haiku | `feedback/` | Running (duplicate check first) |

## Log

- 2026-11-11: idea locked (Callcard, renamed Callout by owner). Verified on chain: perp pools allow 10 bps builder fee (`getMaxBuilderFeeBpsTimes1k` = 10000), taker fee 0, indexer `BuilderFeeRecord` / `BuilderApproval` empty. Repo created at Desktop/callout. Spike started to prove a tagged fill.

- 2026-11-11: web shell accepted. Disk dipped again because of our own npm and .next caches; cleared. Vercel CLI logged in as techkeyy (deploy pending). Dev preview: launch.json lives in the scratch workspace dir (preview tool cwd), port 3111/3112.
