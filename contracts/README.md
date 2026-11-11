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
