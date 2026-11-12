# CallBook v4.1

Immutable on-chain record of trade calls for [Callout](../README.md), on Somnia Tokyo testnet (chain id 50383).
Live: `0xc83b954b22003dbe498c47b2330699466c79661d`. Mechanism spec: [../docs/v4-mechanism.md](../docs/v4-mechanism.md). Security pass: [../docs/v4-audit.md](../docs/v4-audit.md).

There is no owner and no edit function. A call can only be posted and, by its caller, closed once (closing only stops new takes; the call still settles). One immutable `steward` address can withdraw the contract's native STT reserve (the 32 STT Somnia requires for a Reactivity subscription) and nothing else: it cannot touch bonds, calls or outcomes.

## Test

    forge test        # 60 tests

`forge-std` is not vendored. Fetch the pinned release once:

    git clone --depth 1 --branch v1.17.0 https://github.com/foundry-rs/forge-std lib/forge-std

`foundry.toml` sets `evm_version = "cancun"` because the tests mock the Reactivity precompile at 0x0100, which newer EVM versions treat as a native precompile.

## What it does

- `post(pool, isLong, entry, stop, target, expiresAt, note, capacity, bond)` pulls the USDso bond (approve CallBook first). The pool must be registered on dreamDEX's MarginBank, the mark must sit between stop and target, the entry within 0.5% of the mark, the stop 0.1% to 10% from entry, the target at least as far as the stop, and `bond >= max(minBond, 2% of capacity)`. One open call per caller per pool.
- `watch()` creates the Reactivity subscription on MarginBank's `BuilderFeeCharged` event (send at least 32 STT with it). Each fill that names the caller as builder is credited to the caller's open call in the same block, up to its capacity (size = fee x 1000).
- `resolve(id)` is permissionless and reads `pool.tryGetMarkPrice()`: price first, then time. Past the stop is STOPPED, past the target is HIT, after expiry anything else is EXPIRED and settled at the price. `StalePrice` if the pool reports not-ok.
- `claim(id)` settles first if nobody has, then pays out: HIT returns the bond to the caller, STOPPED splits it among takers by covered size, EXPIRED pays takers a forfeit proportional to the adverse move and the caller the rest. No covered takers means the caller gets the bond back.
- `getRecord(caller)` returns hits, stops and expired counts; `claimableOf(id, who)` previews a claim.

## Constructor and deploy

`CallBook(marginBank, bondToken, minBond, steward)`. Hideki: marginBank `0x478769E1177C0773c43A593DCCc4Ad15F15F1394`, bondToken USDso `0xed7993A74dAe1e6656B704A424DcD8711aAf4F72` (18 decimals), minBond `5e18`.

Forge's local gas estimate is far too low on Somnia (the first deploy used about 21M gas). Use `cast` with an explicit gas limit:

    export DEPLOYER_KEY=0x...   # funded with STT; never commit it
    forge build
    cast send --create $(jq -r .bytecode.object out/CallBook.sol/CallBook.json)$(cast abi-encode "constructor(address,address,uint128,address)" 0x478769E1177C0773c43A593DCCc4Ad15F15F1394 0xed7993A74dAe1e6656B704A424DcD8711aAf4F72 5000000000000000000 <steward> | cut -c3-) \
      --rpc-url https://api.hideki2.infra.testnet.somnia.network --private-key $DEPLOYER_KEY --legacy --gas-limit 30000000

Then call `watch()` with at least 32 STT. `script/Deploy.s.sol` is kept for reference; if you use it, pass `--gas-limit 30000000 --skip-simulation`.

## ABI

`out-abi/CallBook.json` is the ABI array the web app copies. Regenerate with:

    forge inspect CallBook abi --json > out-abi/CallBook.json

`lib/reactivity/` is Somnia's Reactivity base contract and interfaces (MIT, Somnia Foundation).
