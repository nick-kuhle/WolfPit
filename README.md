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

**Together these two keys can move the vault's trading inventory**: the owner
allowlists a router and grants it an allowance, and the operator calls it. That
is a deliberate design trade — the keeper must be able to hedge on the fill —
so the path is constrained rather than left open (WP-05 / #12, now enforced in
code, not just documented):

- **`owner` must be a contract.** The constructor reverts `OwnerNotContract()`
  on an EOA, so the multisig requirement is a property of the deployment rather
  than an intention. `DeployBase.s.sol` passes the enforcement flag; the
  `Deployer` launch-shape helper opts out because `address(this)` has no code
  mid-construction, and it is not on the mainnet deploy path.
- **`allowTarget`, `setAllowance`, `allowSelector` and `setAllowanceCap` are
  timelocked** behind `ADMIN_TIMELOCK = 2 days`. Each is a two-step
  queue-then-apply; the queued id binds the exact parameters, so queueing a
  benign action cannot authorise a different one, and each is single-use.
  Depositors get two days of on-chain notice and can withdraw before a new
  router or a larger grant takes effect.
- **Allowances are capped per token**, not `type(uint256).max`: 1,000,000 USDC
  and 500 WETH by default. Per-token because one scalar cannot span decimals —
  `1e12` is 1,000,000 USDC but 0.000001 WETH. An unconfigured token has a cap of
  0, so grants to it fail closed. Raising a cap is itself timelocked.
- **`exec` enforces a function-selector allowlist.** An allowlisted *address* is
  not sufficient: routers expose several token-moving entry points, so arbitrary
  calldata to an allowlisted router would still be a drain path. Calls with an
  unlisted selector revert `BadSelector()`, and calldata shorter than four bytes
  reverts `BadCalldata()`.
- `operator` must be a dedicated hot key holding no other funds.

What remains an operational requirement rather than a code invariant: the
`owner` multisig's own threshold and signer set. The contract can verify that
`owner` is a contract; it cannot verify that the contract is a 2-of-3 rather
than a 1-of-1. Check the Safe's configuration before depositing.

What the keys **cannot** do: `writeCall` reverts if `size > freeEth()`,
`writePut` reverts if `size·strike > freeUsdc()`, `exec` and `openShort` revert
if real balances would fall below the insurance reserve or the reserved book,
and `haltShortGamma()` fails closed on a dead oracle, zero insurance, or
insurance below 1% of NAV. The inventory law (`reserved ≤ α·balance`, α = 0.40)
is enforced on every risk-increasing path including LP withdrawal.
