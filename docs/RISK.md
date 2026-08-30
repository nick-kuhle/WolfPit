# Risk / hedge engine — v1.0 (simulated)

Surgical. Every number below is a **hard reject** in code, not a dashboard wish.

## State

```
Δ  = vault delta (ETH), after reserved spot
Γ  = vault gamma (per $1 of spot) * size   # short options ⇒ Γ < 0
ν  = vault vega (USDC per 1.00 vol)
Θ  = vault theta (USDC / day)
U  = reservedETH / vault.ETH
```

Sign: users buy calls/puts and long/short futures. Vault is the other side. Spot reserve is the hedge. After a legal fill, `|Δ|` ≤ band.

## Limits (v1, ETH only)

| Limit | Value | If breached |
| --- | --- | --- |
| Utilization α | 0.40 | reject new risk-increasing fills |
| Unhedged \|Δ\| | `max(0.05 ETH_vault, 0.02 NAV/S)` | hedge; if hedge fails, pull quotes |
| Short call size | ≤ free ETH | reject (no naked calls) |
| Short put notional | ≤ free USDC | reject (no naked puts) |
| \|Γ\| × S² × σ² × (1h) | ≤ 2% NAV | stop writing ATM |
| \|ν\| | ≤ 15% NAV | stop writing |
| OI / expiry | ≤ 25% vault ETH | that expiry blank |
| OI / strike | ≤ 10% vault ETH | that strike blank |
| User IM / MM | 25% / 12.5% (4×) | isolate; liq |
| Single fill | ≤ 10% remaining band | split or reject |
| Circuit | 5m \|return\| > 3 × IV × √(5/525600) | halt **new shorts** 15m |

σ in the gamma cash test is **IV**, not hope.

## Liquidation

Isolated per futures position.

```
equity = margin + signed_PnL
if equity < MM: liquidate
penalty = min(max(equity,0), 1% * size * S) → insurance
remainder to trader            # ALWAYS paid in full (engine F11)
if equity ≤ 0 after mark: insurance eats the hole; pause if insurance < 0
```

Shortfall rule (F11): the vault pays the remainder from its free USDC first;
whatever it cannot cover is drawn from insurance. If insurance itself cannot
cover it, insurance goes NEGATIVE and the circuit breaker trips (everything
halted on the next engine step, visible on the tape) — the trader is never
silently haircut. ADL remains the last resort after insurance is empty.

No cross-margin in v1. Options: user already paid premium (long only). No user short options in v1.

ADL: only if insurance is empty **and** a hole remains. Haircut winners pro-rata on that expiry. Treat as a page-one incident.

## Hedge rungs

| Rung | v1 | Later |
| --- | --- | --- |
| 1 Spot in ETH/USDC | **yes, mandatory** | still first |
| 2 Hyperliquid ETH perp | no | when util > 0.30 and spot slip too fat |
| 3 Own dated futures | no | when our book is two-sided enough |

Rung 2 is a **borrowed delta**, not leverage for the house. Vault still cannot sell a naked call.

## Insurance

Seed in sim: $25,000 USDC (synthetic). Feeds:

- 1% liq penalty
- 10% of WPIT emissions (sold to USDC in production)
- 1% harvest tax

Target: ≥ 99th percentile 1h HE (see MM.md). If insurance / NAV < 1%, halt new short gamma.

## Oracles / expiry

v1 sim: last tick. Production on Base:

- Mark: Chainlink ETH/USD + Uni v4 TWAP (30 min), take the **less aggressive** for vault-favorable, median for trader MM
- Expiry settle: 30–60 min TWAP ending 20:00 UTC Friday
- If oracles diverge > 1.5%: pause listings, do not expire on a print

## Stress the sim must pass before live

Recorded drills, not vibes:

1. ETH −20% in one hour, one-sided longs, keepers delayed 2 minutes
2. ETH +40% (naked-call test — must **not** be possible)
3. Witching: 80% of OI expires ITM
4. Empty other side (A shorts 4000, B longs 3000, A scratches) — B paid from hedge P&L, LP NAV restored
5. Util → α, next order rejected, quotes widen

If any drill leaks LP USDC that is not a posted spread, do not ship.

## Code map

`src/lib/wolfpit/engine.ts` — reject rules, IM/MM, cover.  
`bookGreeks()` — Δ, Γ, ν for the desk.  
Watchlist — util, IV, RV, insurance, max net.  
Do not put a “risk officer” button that overrides α.
