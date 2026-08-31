# WolfPit

Term crypto futures and vanilla options. Inventory-backed. Never naked. **Base, not Ethereum L1.**

This repository ships:

1. A thinkorswim-style **paper desk** (spot, mini futures, mini options).
2. Simulated **WOLFPIT-USDC-TEST** and **WOLFPIT-ETH-TEST** pools, util-weighted farms, staking.
3. Quant specs: LP, farm, MM, hedge/risk — v1.0 simulated.

## What is live and what is not

| Surface | Status | Real funds? |
| --- | --- | --- |
| `/trade?mode=live` spot swap | **LIVE** | **Yes** — `src/lib/swap/quote.server.ts` builds firm, executable **Base mainnet** transactions through a DEX aggregator (0x Swap API v2), with an on-chain integrator fee paid to a real WolfPit wallet. Multi-chain: 16 chains. |
| `/trade` simulation desk | Paper | No — $100,000 paper USDC, `localStorage` |
| Futures / mini options | Simulated, launch-gated | No — engines complete, closed until a WETH/USDC pit pool is seeded (`VITE_MARKETS`) |
| `contracts/` DealerVault, WPIT, Farm, Stake | Unfunded TEST | No — **not deployed**. No external audit is on record yet. |
| Pools / farms / staking | Simulated | No |

The derivatives desk is a simulation. **The swap page is not** — it signs and
broadcasts real transactions. Do not read this repo as "simulation only".

External audit status: **none on record.** Commission one before any deposit
that is not the maintainer's own, and before any funded vault (see
[docs/DEPLOY-BASE.md](docs/DEPLOY-BASE.md)).

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

## Vercel

Connect this repo in Vercel. Build is `npm run build` (Nitro `vercel` preset). Set `VITE_CHAIN=sim`. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Hard rules

- Home chain target: Base. Hedge-rung later: Hyperliquid. Never L1 for the vault.
- Net longs hedged with ETH. Net shorts hedged with USDC.
- Vault never sells a naked call or put.
- House hedges 1:1. Traders may use 4× IM.
- If the hedge cannot complete, the order does not exist.

## Trust model — what the keys can do

A depositor must know this before depositing (WP-05 / #12). `DealerVault` has
two privileged roles:

| Key | Role | What it can do |
| --- | --- | --- |
| `owner` | multisig (intended Safe 2-of-3) | pause, set the oracle, allowlist aggregator routers, grant token allowances to those routers, fund insurance, slash the junior tranche, transfer ownership (2-step) |
| `operator` | keeper hot key | all risk accounting (`writeCall` / `writePut` / `openLong` / `openShort` / `release*`), `exec` a call to an **owner-allowlisted** router, `reconcileBalances`, pause |

**Together these two keys can move the vault's entire balance**: the owner
allowlists a router and grants it an allowance, and the operator calls it with
arbitrary calldata. That is a deliberate design trade — the keeper must be able
to hedge on the fill — and it is why:

- `owner` must be a multisig, never an EOA;
- `operator` must be a dedicated hot key holding no other funds;
- allowances should be capped to the intended trade size, not `type(uint256).max`;
- both belong behind a timelock before any vault holds someone else's money.

What the keys **cannot** do: `writeCall` reverts if `size > freeEth()`,
`writePut` reverts if `size·strike > freeUsdc()`, `exec` and `openShort` revert
if real balances would fall below the insurance reserve or the reserved book,
and `haltShortGamma()` fails closed on a dead oracle, zero insurance, or
insurance below 1% of NAV. The inventory law (`reserved ≤ α·balance`, α = 0.40)
is enforced on every risk-increasing path including LP withdrawal.

Open hardening (tracked in the issue list): a timelock on `allowTarget` /
`setAllowance`, and a function-selector allowlist on `exec`.
