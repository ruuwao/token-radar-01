# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/ruuwao/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/ruuwao/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token-launch radar for pre-token protocols. It reads a sealed DefiLlama snapshot
(`input/snapshot.json`, as of 2026-11-14, 758 protocols, floor $50M), scores every protocol
that records no token, and hands in a ranked board of 178 rows plus a self-contained
dashboard that explains every row's value.

The value model is comparables, not a list of names: each protocol's implied value is its
TVL times its category's median market-cap-to-TVL among the snapshot's listed protocols
(winsorised, shrunk toward the market median, capped), adjusted for its own 7-day growth,
how long it has run with no token, and how many chains it runs on. The board covers the
whole 40-protocol watchlist and adds 138 early rows below the floor — the launches the
radar exists to find. Wrapped, staked and bridged products of a token that already trades
are left out: their token, in effect, already exists. Every row carries a 7-step farm plan
with a cost and a time, derived from the protocol's own record.

Top of the board: Steakhouse Financial ($578M implied), Gauntlet ($340M), Veda ($327M),
USDD ($195M). The dashboard's detail view recomputes each row's value in the page from
the same figures, shows the category's listed comparables, and the methodology tab prints
the whole model. No network anywhere: the entry runs on the snapshot alone, and the
dashboard reads only its own `data.js`.

## Run it

```sh
# main.ts (Node 22+, stdlib only) scores the snapshot and builds the outputs:
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input token-radar-01-kit/input/snapshot.json
# then open the dashboard:
open out/dashboard/index.html        # or: python3 -m http.server --directory out
```

The run is deterministic: it writes `board.json`, `data.js`, `dashboard/`, `screenshots/`
and `dossier.json`, and two runs write the same bytes. Screenshots live in `screenshots/`
(board, detail, filtered) and are rendered from the dashboard at 1440×900.

---

<sub>Entered on [make.fun](https://make.fun/?ref=tv86zvxh&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
