# WolfPit

Dated crypto futures and options. Inventory-backed. Never naked. **Base, not Ethereum L1.**

This repository ships:

1. A thinkorswim-style **paper desk** (spot, mini futures, mini options).
2. Simulated **WOLFPIT-USDC-TEST** and **WOLFPIT-ETH-TEST** pools, util-weighted farms, staking.
3. Quant specs: LP, farm, MM, hedge/risk — v1.0 simulated.

**Simulation only.** Live contracts are a later adapter on **Base**.

## Run

```bash
npm run dev
```

## Surfaces

| Route | What |
| --- | --- |
| `/` | Venue |
| `/trade` | Desk |
| `/pools` | LP add/remove + farms |
| `/stake` | WPIT (insurance junior) |
| `/plan` | Briefing, Week 1, **Q1** |

## Docs

Start with [docs/DEV.md](docs/DEV.md), [docs/Q1.md](docs/Q1.md), [docs/CHAIN.md](docs/CHAIN.md).

## Tests

```bash
npm run test:engine   # golden G1–G6, RISK caps, drills D1–D5
forge test --root contracts
```

v0.1 is paper. Home chain: Base. Push target when Nick opens it: `nick-kuhle/WolfPit`.

## Hard rules

- Home chain target: Base. Hedge-rung later: Hyperliquid. Never L1 for the vault.
- Net longs hedged with ETH. Net shorts hedged with USDC.
- Vault never sells a naked call or put.
- House hedges 1:1. Traders may use 4× IM.
- If the hedge cannot complete, the order does not exist.
