# X post drafts

Each is under 280 characters and tags @DreamDEXSomnia. Post them, then paste the links into the "X posts" section of the README.

## 0. Launch (post first, with the teaser video)
Video: `Callout_Launch_Teaser.mp4` (35 s, 1080p).

```
anyone can post a trade call. nobody pays when they're wrong.

so i built callout.

post your perps call on chain and back it with a bond. followers take it on @dreamdexsomnia, and you earn on every fill.

stopped out? your bond pays your followers.

https://callout-perps.vercel.app
```

## 1. The bond
Image: screenshot of the STOPPED call card at /c/2, showing the bond and the outcome.

```
Callers now put money behind their calls on Callout. Stopped out? Their bond goes to whoever took the trade.

Posted on-chain, resolved by the live mark price. Built on @DreamDEXSomnia perps.

https://callout-perps.vercel.app/c/2
```

## 2. Reactivity
Image: two explorer tabs side by side, the v2 take tx 0x13ef1b70... and the handler tx 0x7a680f04..., both in block 47023302.

```
How does Callout count who took a call? No server, no indexer.

CallBook listens to @DreamDEXSomnia's builder-fee event with Somnia Reactivity. A validator credits the take in the same block as the fill.

https://callout-perps.vercel.app/c/2
```

## 3. The leaderboard
Image: screenshot of /board with the hit rate column.

```
Who's actually right? Callout ranks callers by hit rate, counted on chain: hits, stops and expiries, no edits possible.

Testnet, paper USDso, @DreamDEXSomnia perps.

https://callout-perps.vercel.app/board
```
