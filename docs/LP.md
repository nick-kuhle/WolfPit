# LP architecture — v1.0 (simulated)

Two pools of capital. Do not mix their jobs.

## A. Spot pools (Uniswap-style)

| Pool | Job | Fee v1 | Cap |
| --- | --- | --- | --- |
| ETH/USDC | Hedge inventory + listing oracle | 5–30 bps, vol-dynamic | deep |
| WPIT/USDC-TEST | Token exit | 30 bps | thin |
| WPIT/ETH-TEST | Token/ETH | 30 bps | thinner |

v1 sim is constant-product (`x*y=k`). Production on Base is **Uniswap v4** with a WolfPit hook:

- `afterSwap` / `afterAddLiquidity` notifies the vault of depth
- Dynamic fee = `f0 + k_σ * max(0, RV − IV_floor)`
- No hook is allowed to let the vault go naked

Concentrated liquidity (v1.1): LPs may concentrate around spot. The vault **does not** use concentrated ETH as cover. Cover is full-range or idle inventory in the dealer vault. Pin risk is not an LP toy.

## B. Dealer vault (the pit)

LPs deposit ETH + USDC. They receive `wpETHUSDC` vault shares.

```
NAV = ETH*S + USDC
    + MTM(short futures) + MTM(long futures)
    + MTM(short options)     # always ≤ 0 for the house on a mark-to-mid, plus residual
    − trader credits
    + insurance (not shareable until epoch)
```

Single tranche in v1. No senior/junior. First loss is:

1. Insurance fund (WPIT stake + liq penalties + 10% of emissions)
2. Then vault NAV (LPs)
3. Then pause listings (never mint)

### Inventory law

Let  
`L` = trader net long futures (ETH)  
`S_n` = trader net short futures (ETH)  
`C` = vault short-call size (ETH)  
`P$` = Σ strike × short-put size (USDC)

```
reservedETH  = L + C
reservedUSDC = S_n * S + P$
reservedETH  ≤ α * vault.ETH          α = 0.40
reservedUSDC ≤ α * vault.USDC
ETH weight w = vault.ETH * S / NAV
target w ∈ [0.45, 0.55]
if w ∉ [0.40, 0.60]: rebalance via spot (not by quoting worse options)
```

If a fill would break this: **reject**. No queue. No “hedge in the next block.”

### LP return (what we actually sell)

```
r_LP ≈ swap_fees
     + option_theta_captured
     + futures_spread
     − hedge_error
     − IL_on_spot_pool
     − emissions_dilution (if they also farm)
```

Ledger note (F8): `option_theta_captured` is realized in the sim as the option
PREMIUM being credited to `vault.usdc` at write time and the expiry PAYOFF
being debited from the vault (covering ETH converted at the settlement spot for
calls; the cash-secure collateral released for puts). `vaultNav()` computes the
full LP.md formula — `ETH·S + USDC + MTM(short options) − trader credits +
insurance` — so the premium is visible in NAV immediately and the payout
reduces it at settlement.

If `r_LP` looks like long ETH, the risk engine is broken. Kill the tape, do not raise emissions.

### v1 sim numbers

- Vault start: 100 ETH + 400,000 USDC
- α = 0.40
- Add liquidity: both legs, proportional
- Shares: `Δsupply = Δquote / quoteReserve * supply`

Build order: keep CPMM in sim → v4 hook spec in Foundry → concentrated as opt-in for *spot LPs only*.
