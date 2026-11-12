# spike/

Scratch scripts from the first days of the build, kept as evidence of how the protocol was explored. They are not part of the app.

- `prove.mjs`: the original proof that a builder-tagged perps fill pays the caller (deposit, approve, tagged IOC order, bracket, withdraw). Its transactions are in the README proof table's history.
- `signer.mjs`: a local test-only stand-in wallet used to drive the UI during development. Never deployed.
- the rest (`acct`, `bal`, `elig`, `fund`, `keys`, `logs`, `mark`, `tag`, `vtest`, `e2e`, `_post4`): one-off probes.

All of them read funded testnet keys from a gitignored `spike/.env` that is never committed.
