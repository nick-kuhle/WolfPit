# Market-making architecture — v1.0 (simulated)

The house is a **dealer**, not a vAMM and not an HFT shop on L1. Quotes exist only if the hedge exists.

## Objects

| Book | Mid | What you sell |
| --- | --- | --- |
| Spot | pool price | 5–30 bps, vol-dynamic |
| Mini futures | `F = S e^{(r−q)T}` ≈ `S` (q≈0 in v1) | inventory spread |
| Mini options | Black-Scholes, r=0.03 | IV + skew + inventory |

Contract: mini = 0.1 ETH. Expiries: Friday week-1, week-2, month-end. European cash-settle. User **buys** options in v1; vault writes only covered/cash-secured. User futures both ways, vault 1:1.

## Spot

Constant product in sim. Production: Uni v4.

```
fee_bps = 5 + 80 * max(0, RV − 0.40)     # clamp 5–30
```

## Futures quote

```
s_bps = 8
      + 80 * util
      + 40 * (IV − 0.40)
      + 25 * |Δ_book| / vault.ETH
ask = F * (1 + s_bps / 1e4)
bid = F * (1 − s_bps / 1e4)
size_bid = maxNetShortETH     # vault would go long
size_ask = maxNetLongETH      # vault would go short
```

If `size_* = 0`, that side is blank. Not a 9-figure quote with a 2-tick width.

Reservation (Avellaneda–Stoikov, discrete):

```
r = F − q * γ * σ² * τ
spread ≥ γ * σ² * τ + (2/γ) ln(1 + γ/k)
q  = inventory in ETH (signed, vault)
γ  = 0.1 / vault.ETH     # risk aversion; smaller vault → wider
τ  = 2 minutes           # quote horizon, Base block reality
σ  = RV (annual)
```

v1 sim uses the `s_bps` stack (same spirit, fewer knobs). Do not add a neural net.

## Options quote

ATM IV:

```
RV_t = λ·RV_{t-1} + (1−λ)·|ln(P_t/P_{t-1})|
σ    = RV · sqrt(π/2) · sqrt(365.25*24*60 / barSec)        # MAD -> sigma
λ    = 0.5 ^ (barSec / halfLifeSec),  halfLife = 4 h       # derived, not inherited
IV_atm = clamp(1.08 * σ, 0.28, 1.60)                       # 8% vol premium
```

Two corrections, both measured (issues #20 / M-01 and #25 / M-02):

1. **`sqrt(π/2)` is mandatory.** An EWMA of `|r|` converges to `E|r|`, which for
   a normal return is `σ·sqrt(2/π) ≈ 0.7979σ`. Annualising it raw understated
   realised vol by 20.2%, so `IV = 1.08·RV` was a **13.8% discount** rather than
   an 8% premium — on a book that is structurally short gamma. The 1.08 premium
   now means what it says.
2. **λ must be derived from the bar interval.** RiskMetrics calibrated λ=0.94
   for *daily* bars (a ~1-month window). On 1-minute bars the same constant is a
   17-minute memory pricing weekly options. We state a half-life in *minutes*
   and derive λ from it, so the memory survives a change of bar interval.

**Dispersion is a data-length problem, not a λ problem.** Lengthening λ without
lengthening the history makes the estimate worse, not better — with a window far
longer than the tape the accumulator is still dominated by its first
observation. Measured p05–p95 spread at a known σ = 0.60 (√(π/2)-corrected):

| λ / half-life | eff. bars | 5 h of tape | 48 h | 336 h |
| --- | --- | --- | --- | --- |
| 0.94 (17 min) | 17 | 42%σ | 43%σ | 42%σ |
| 0.9971 (4 h) | 347 | 100%σ | **10%σ** | 10%σ |
| 0.9995 (24 h) | 2078 | 206%σ | 59%σ | **4%σ** |
| 0.99996 (17 d) | 25000 | 235%σ | 212%σ | 106%σ |

The live feed supplies ~300 one-minute bars (~5 h), so the honest fix for
dispersion is to **fetch a longer history** (a separate 1h-bar series) and then
move the half-life out — not to raise λ on 5 hours of tape.

Smile (sticky-delta, 3-point, v1):

```
z     = ln(K/S) / sqrt(max(T, 1/365))
IV(K) = IV_atm * (1 − 0.18 * z)          # OTM puts richer (crypto)
IV(K) = clamp(IV(K), 0.20, 2.00)
```

Skew sign: `z < 0` (K < S) → higher IV. Do not “learn” a 12-parameter SVI in v1. Fit SVI in a notebook; promote only if out-of-sample week beats this.

Premium:

```
mid = BS(S, K, T, r=0.03, IV(K))
ask = mid * (1 + s_bps/1e4) + 0.40 USDC
bid = max(0.05, mid * (1 − s_bps/1e4) − 0.40)
```

Inventory: if vault is already short calls, add `+0.5 vol-pt` to call IV. If short puts, same on puts. If that would exceed vega cap, **do not quote**.

## Hedge (rung 1 only in v1)

On every fill that changes Δ:

```
Δ = −L + S_n − Σ Δ_call * C + −Σ Δ_put * P
# with reserved spot, target Δ ≈ 0
if |Δ_unhedged| > band: trade spot until |Δ| ≤ band/2
band = max(0.05 * vault.ETH, 0.02 * NAV / S)
if estimated slippage > 0.5 * spread_captured: do not quote that size
```

Hedge error (discrete, the only honesty that matters):

```
HE ≈ 0.5 * Γ * (ΔS)²  +  Δ * slip
ΔS  = S · σ_stress · sqrt(1h) · z,   z = 2.5758   # TWO-SIDED 99th pct of |Z|
```

`z = 2.5758` is `Φ⁻¹(0.995)`, the two-sided 99th percentile of `|Z|` — a
short-gamma book loses on a move in **either** direction. The one-sided
`Φ⁻¹(0.99) = 2.326` used previously understated the insurance requirement by
`(2.5758/2.3263)² − 1 = 22.6%` (issue #24 / M-03).

**Convention note (issue #27 / M-04):** `gammaCash1h()` deliberately returns
**2×** the textbook `½·Γ·S²·σ²·Δt`, so the `GAMMA_NAV = 2% NAV` cap binds at half
the documented exposure — a 2× safety factor. `hedgeError99()` uses the textbook
½ because it is a tail estimate, not a cap. Both are commented in `risk.ts`; do
not "make them agree" without re-deriving `GAMMA_NAV`.

Insurance must cover the 99th percentile 1-hour HE at current Γ under 80% ETH vol. If it does not, cut Γ (stop writing ATM).

## What this is not

HFT colocated on MegaETH. A vAMM that prints against LPs. A perp with hidden funding. American 0-DTE.

Build: `src/lib/wolfpit/engine.ts` already rejects naked, sizes to inventory, and spreads on util. v1.0 sim adds RV→IV, skew, Δ/Γ panel, insurance.
