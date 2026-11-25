# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/hermawan-be/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/hermawan-be/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Token Radar ranks every pre-token protocol in a sealed DefiLlama snapshot by the implied value of the token it has not launched yet — and gives each one a concrete farm plan. The base multiple is not a guess: it is the median market-cap/TVL of the snapshot's own live-token protocols, computed at run time. Growth is damped on small TVL, and a five-year maturity horizon pays long no-token runs up to 1.2x. The board covers the whole watchlist plus every other rankable pre-token protocol in the snapshot (197 rows on the 2026-11-14 snapshot), with a static dashboard that renders with no network.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

Node 22 or later, standard library only. `main.ts` reads the sealed snapshot, writes `board.json` and `data.js`, copies `dashboard/` and `screenshots/` into the output directory, and writes `dossier.json` with the vendored `vendor/makefun-board.ts` library.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
