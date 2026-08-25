# Dev handbook

Paper first. Same desk later points at Base Sepolia.

## Run the venue

```
npm run dev          # 0.0.0.0:8080
npm run test:engine  # G1–G6, RISK, drills
forge test --root contracts
cargo test -p wolfpit-keeper
```

Copy `env.example` to `.env` if you need flags. Default is paper sim.

## Surfaces

| Path | Who |
| --- | --- |
| `/` | Users — pit, three doors |
| `/trade` | Desk (spot / mini fut / mini opt) |
| `/pools` | LP add/remove, harvest 1% tax |
| `/stake` | First-loss WPIT |
| `/plan` | Nick + team |

## Contracts

`contracts/` Foundry. `crates/keeper` Alloy 2.x. Wiring: `Deployer.sol` and `test/System.t.sol`.

Do not deploy funded. Do not Ethereum L1.

## Quoting

All bands in `src/lib/wolfpit/risk.ts` and [RISK.md](./RISK.md). If the hedge cannot complete, the order does not exist.

## PR bar

- `npx tsc --noEmit`
- `npm run test:engine`
- `forge test --root contracts` if Solidity changed
- No yield copy. No purple. No `hedgeLater()`.
