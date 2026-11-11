# CallBook

Immutable on-chain record of trade calls for Callout (Somnia Tokyo testnet "Hideki", chain id 50383).
No owner, no admin, no upgrade, no edit function. Calls can only be posted and, by their caller, closed once.

## Test

    forge test

## Deploy

    export DEPLOYER_KEY=0x...   # funded with STT; never commit it
    forge script script/Deploy.s.sol --rpc-url https://api.hideki2.infra.testnet.somnia.network --private-key $DEPLOYER_KEY --broadcast --legacy

`--legacy` is the conservative choice (type-0 gas pricing); drop it if the RPC accepts EIP-1559 txs.

## ABI

`out-abi/CallBook.json` is the ABI array. Regenerate with:

    forge inspect CallBook abi --json > out-abi/CallBook.json

## Takes (Somnia Reactivity)

The constructor takes the dreamDEX MarginBank address (Hideki: `0x478769E1177C0773c43A593DCCc4Ad15F15F1394`).
`watch()` creates one Reactivity subscription on the MarginBank's `BuilderFeeCharged` event; each fill that
names the caller as builder is credited to the caller's open call (`getTakes`, `hasTaken`, `TakeRecorded`).
One open call per (caller, pool): `openCallOf(caller, pool)` returns 0 when none is open.

Setup after deploy: call `watch()` with at least 32 STT (`cast send <addr> "watch()" --value 32ether ...`).
STT sent to this contract (via `watch()` or plain transfer) funds handler gas and **cannot be withdrawn**
(no owner, no withdraw). Testnet only.

Tests that mock the 0x0100 precompile need `evm_version = "cancun"` in `foundry.toml`, since newer EVM versions treat 0x0100 as a native precompile.

## v3: bonds, resolution, claims

Constructor: `CallBook(marginBank, bondToken, minBond)`. Hideki: marginBank `0x478769E1177C0773c43A593DCCc4Ad15F15F1394`,
bondToken USDso `0xed7993A74dAe1e6656B704A424DcD8711aAf4F72` (18 decimals), minBond `5e18`.

- `post(pool, isLong, entry, stop, target, expiresAt, note, bond)` pulls `bond` USDso (approve CallBook first). The old 7-arg `post` is gone.
- `resolve(id)` is permissionless. At/after `expiresAt` the outcome is Expired (no price read). Before that it reads
  `pool.tryGetMarkPrice()`: long Hit if mark >= target, Stopped if mark <= stop (short mirrored); otherwise `NotResolvable`;
  `StalePrice` if the pool reports not-ok. `close()` does NOT end exposure: a closed call can still resolve Hit/Stopped
  until expiry; it only stops new takes being credited. Resolved calls never receive takes.
- `claim(id)`: Hit/Expired pay the full bond to the caller. Stopped pays takers pro rata by builder fees paid (`feeOf`);
  if nobody took the call, the caller gets the bond back. Rounding dust stays in the contract.
- `getRecord(caller)` returns hits, stops and expired counts. `claimableOf(id, who)` previews a claim.

### Deploy (forge's gas estimate is far too low on Somnia: the v2 deploy used ~21M gas)

Use `cast` with an explicit gas limit rather than `forge script`:

    forge build
    cast send --create $(jq -r .bytecode.object out/CallBook.sol/CallBook.json)$(cast abi-encode "constructor(address,address,uint128)" 0x478769E1177C0773c43A593DCCc4Ad15F15F1394 0xed7993A74dAe1e6656B704A424DcD8711aAf4F72 5000000000000000000 | cut -c3-) \
      --rpc-url https://api.hideki2.infra.testnet.somnia.network --private-key $DEPLOYER_KEY --legacy --gas-limit 30000000

Then fund and call `watch()` (>= 32 STT). `script/Deploy.s.sol` is kept for reference only; if used, pass `--gas-limit 30000000` (and `--skip-simulation`).
