# Callout web app

Next.js 16 app for [Callout](../README.md): the landing page, composer, Explore feed, call cards (`/c/<id>`), profiles (`/u/<address>`), the leaderboard (`/board`) and the share images.

```bash
cp .env.example .env.local    # CallBook v4.1 address and site URL are pre-filled
npm install
npm run dev                   # http://localhost:3000
npm test                      # vitest, 176 tests
npx tsc --noEmit              # type check
```

`scripts/keeper.ts` resolves calls; `scripts/take-e2e.ts` runs the whole loop on testnet; `scripts/probe-*.ts` are read-only diagnostics. The scripts that send transactions read their key from the environment or the gitignored `spike/.env`, and never print it.
