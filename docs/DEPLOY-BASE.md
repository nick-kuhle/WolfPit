# Base mainnet launch runbook — vault-only, no WPIT, no house pool

**Launch shape** (decided 2026-08-29): deploy `DealerVault` + `ChainlinkOracle`
on Base with **native USDC + canonical WETH**, **no WPIT token**, **no house
liquidity pool**, and **no Farm/Stake/SimplePair**. Spot trades route through a
**DEX aggregator** against external WETH/USDC liquidity. Futures and options are
**launch-gated OFF** in the desk (`VITE_MARKETS=spot`) — the engines behind the
gate are complete and volatility/IV-safe (MM.md/RISK.md); they unlock when a
WETH/USDC pit pool is seeded (`VITE_MARKETS=spot,future,option`).

## What changed for launch (2026-08-29 fixes)

- `DealerVault`: owner (multisig) + operator (keeper) roles on every sensitive
  entry point; `haltShortGamma()` is oracle-backed and **fail-closed** (zero
  insurance, dead oracle, or insurance/NAV < 1% ⇒ halt) and now gates BOTH
  `writeCall` and `writePut` (short puts are short gamma too);
  `openShort(size, router, data, minOutUsdc)` is **atomic** — the allowlisted
  router swap executes in the same tx, the book is updated from the REAL
  balance deltas, the reservation is marked at the **oracle**, and a bad fill
  (`< minOutUsdc`) reverts the whole order (no un-booked drift);
  `reconcileBalances()` re-syncs internal counters to real balances and
  REVERTS (refusing to run) if real balances sit below reserved amounts;
  dual-asset deposits are **oracle-valued** (no 18-dec/6-dec unit mixing) with
  a $5k first-deposit floor and a $1 virtual-share offset against inflation;
  `exec(target, data)` lets the keeper route swaps through
  **owner-allowlisted aggregator routers** with owner-set token allowances;
  `slashInsuranceJunior()` finally reaches the junior tranche (Stake.slash);
  2-step ownership transfer. `DeployBase.s.sol` refuses to run on a chain that
  is not Base mainnet (8453) unless `BASE_ALLOW_ANY_CHAIN=1` is set explicitly.
- `ChainlinkOracle`: staleness (1h), positivity, and sanity-band checks; a bad
  feed reverts and the vault halts risk-taking rather than marking fantasy.
- Keeper (F3): can now TRANSACT — `WOLFPIT_KEEPER_KEY` signs as the operator
  for `writeCall` / `writePut` / `openShort` (atomic swap) / `reconcileBalances`
  / `pause` / `releaseCall`; a `monitor` loop reads
  `owner/operator/navUsdc/haltShortGamma()` and FAILS CLOSED by pausing the
  vault on-chain on halt/naked conditions. Without a key, it dry-run encodes.
- Engine (paper/sim parity): liquidation conservation (trader gets equity −
  penalty, insurance is funded, holes pause the pit), 1×/10×/60× clock,
  day-PnL, MM.md spread/reservation/hedge-band/±0.40 option edge, LP.md weight
  rebalancing, FARM.md gauges, insurance ≥ 99th-pct 1h hedge error @ 80% vol.

## Addresses (Base mainnet)

| What | Address | Verify at |
| --- | --- | --- |
| Native USDC | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | developers.circle.com |
| Canonical WETH | `0x4200000000000000000000000000000000000006` | basescan (genesis deploy) |
| Chainlink ETH/USD | **set at deploy time** | data.chain.link → Ethereum → Base → ETH/USD |

Do NOT trust any aggregator address from a blog or chat — pull it from
data.chain.link the day you deploy and cross-check the proxy on BaseScan.

## Pre-flight

1. **Keys**: `BASE_OWNER` = a multisig (e.g. Safe 2/3). `BASE_OPERATOR` = a
   dedicated hot key for the keeper. They must differ.
2. **Oracle**: copy the Chainlink ETH/USD aggregator proxy address from
   data.chain.link (Base). Sanity: `cast call <agg> 'latestAnswer()(int256)' --rpc-url $BASE_RPC_URL` ≈ ETH spot × 1e8.
3. **Fund**: the deployer wallet needs ETH for gas on Base.
4. **Dry-run everything on Base Sepolia first** (`BASE_RPC_URL=https://sepolia.base.org`, chain 84532).

## Deploy

```bash
export PATH="$HOME/.foundry/bin:$PATH"
cd contracts

# env (no defaults for anything trust-bearing):
export BASE_RPC_URL=https://mainnet.base.org
export BASE_ORACLE_AGG=0x...        # from data.chain.link, day-of
export BASE_OWNER=0x...             # multisig
export BASE_OPERATOR=0x...          # keeper hot key
# export BASE_ALLOW_ANY_CHAIN=1    # ONLY for Sepolia dry-runs; mainnet script refuses non-8453

forge script script/DeployBase.s.sol \
  --rpc-url $BASE_RPC_URL --broadcast \
  --verify --etherscan-api-key $ETHERSCAN_API_KEY
```

Terminal prints `oracle=`, `vault=`, `usdc=`, `weth=`. Record them.

**Immediately after deploy (from the OWNER multisig):**

1. `vault.creditInsurance(<seed USDC>)` — fund insurance (target ≥ 1% of NAV;
   the paper model seeds $25k against an $800k vault). CRITICAL (F16): this is
   an ACCOUNTING-ONLY credit — no USDC moves. Transfer the backing token to
   the vault FIRST (before or after the credit) or the insurance fund is not
   backed 1:1 and any liquidation/settlement that draws it will simply drain
   the vault's real USDC. Back it with treasury funds.
2. Seed the vault: `vault.deposit(<WETH>, <USDC>)` from the treasury (first
   deposit must be ≥ $5k of value). This is the dealing inventory.
3. Allowlist the aggregator router(s): `vault.allowTarget(<router>, true)` and
   `vault.setAllowance(usdc, <router>, <cap>)` / `(weth, …)`.
4. Hand the keeper its key: it is `operator` from deploy; rotate with
   `vault.setOperator(...)` if needed.

## Keeper

```bash
cd crates/keeper
export WOLFPIT_RPC=https://mainnet.base.org
export WOLFPIT_VAULT=0x...
export WOLFPIT_CHAIN=base
# read-only health (no key needed):
cargo run -p wolfpit-keeper -- --rpc $WOLFPIT_RPC --vault $WOLFPIT_VAULT status
# transacting (operator key — NEVER on the owner multisig):
export WOLFPIT_KEEPER_KEY=0x...
cargo run -p wolfpit-keeper -- --rpc $WOLFPIT_RPC --vault $WOLFPIT_VAULT write-put --size-eth 1 --strike-usdc 4000
cargo run -p wolfpit-keeper -- --rpc $WOLFPIT_RPC --vault $WOLFPIT_VAULT open-short \
  --size-eth 1 --router 0x... --min-out-usdc 3900 --data 0x...
# fail-closed watcher: pauses the vault on-chain when haltShortGamma/naked trips
cargo run -p wolfpit-keeper -- --rpc $WOLFPIT_RPC --vault $WOLFPIT_VAULT --interval 30 monitor
```

`status` prints the oracle-backed halt check (`halt=true` ⇒ do not write gamma).
Any txn command without a key (or with `--rpc` unset) prints the calldata only —
handy for a Safe/hardware signer. Hedging is `openShort`/`exec`
(`<allowlisted router>`, `<swap calldata>`) signed by the operator key.

## Desk (frontend)

```env
VITE_CHAIN=base
VITE_VAULT=0x...        # from deploy output
VITE_MARKETS=spot       # launch gate; add ,future,option when the pool exists
ADMIN_USER=... ADMIN_PASS=... ADMIN_SESSION_SECRET=$(openssl rand -hex 32)
DATABASE_URL=postgres://...   # Neon or equivalent; unset = local PGLite
```

`npm run build` and deploy (Vercel preset configured). The order ticket shows
spot only; perps/options show the unlock note. Server-rendered admin auth now
fails closed without real credentials.

## When the pool is seeded (later)

1. Deploy `SimplePair` + (optionally) WPIT/Farm/Stake via `Deployer(true)` on a
   **test** chain first — those paths are for the token era and are not part of
   this launch.
2. Flip `VITE_MARKETS=spot,future,option` and set the pool env vars.
3. Re-run the risk drills (`npm run test:engine`) before opening the gates.

## Known launch limitations (read before deploying)

- **Deposit-only vault**: there is no `redeem/withdraw` yet (v1 scope — epoch
  accounting arrives with the share-price oracle cadence). Seed with treasury
  funds you will not need to pull quickly.
- **Oracle is single-source Chainlink** with sanity bands; the RISK.md
  "Chainlink + TWAP, take the less aggressive" median is the v1.1 upgrade.
- **`setAllowance` uses a raw `approve`** — fine for USDC/WETH (no
  fee-on-transfer); re-audit if you allowlist exotic tokens.
- **Insurance credit is accounting** — back it with real funds moved to the
  vault treasury, tracked off-chain, until the insurance escrow module lands.
- The paper sim models aggregator depth as a 2,500 ETH external book
  (`engine.ts` initialState); real routing depth must be monitored via the
  aggregator API before enabling large sizes.
