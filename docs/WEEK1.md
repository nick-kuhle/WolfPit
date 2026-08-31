# Week 1 work order

**Window:** Tue 25 Aug 2026 → Mon 31 Aug 2026  
**Home:** Base (sim). Not Ethereum L1. Not Hyperliquid.  
**Law:** [RISK.md](./RISK.md) numbers are hard rejects. Quant sets bands. CTO implements. CEO does not override α.  
**Log:** append daily to [BUILD-NOTES.md](./BUILD-NOTES.md).

## Seats

| Tag | Seat | Week 1 owns |
| --- | --- | --- |
| N | CEO (Nick) | Sign α, counsel intro, Friday demo, no tape override |
| P | CTO / protocol | Foundry skeleton, DeskEngine extract, vault math tests |
| Q | Head of quant | Remaining RISK limits in sim, five drills, quote knobs |
| U | UI lead | Blank quotes, reject reasons, tick-log export, gauges |
| L | GC (fractional) | ToS stub, no-yield pass on copy |

If a seat is empty, **do not skip the ticket**. Nick parks it or the filled seat takes it. Unowned risk work does not ship.

## Capacity

Assume 3 builders × 5 days × 6h = **90h**. Scheduled ~78h. Slack is for drills that fail.

## Week 1 is done when

1. Every [RISK.md](./RISK.md) v1 limit is enforced in `engine.ts` or explicitly `wontfix: week 2` in the log with Q sign-off.
2. Five drills in RISK.md run as recorded tests. All pass. Artifacts linked in the log.
3. `forge test` on a vault skeleton encodes inventory law (α=0.40, covered call, cash-secured put). No Uni v4 hook yet.
4. Desk blanks a side when size is 0 and prints the reject string on the ticket.
5. Friday demo: Nick watches +40% (calls still covered) and −20% (longs liquidate, insurance takes penalty, LP NAV not a piggy bank).

## Out of scope (do not start)

- Uniswap v4 hook
- Base Sepolia deploy
- Hyperliquid hedge adapter
- User-sold options
- veWPIT voting / gauge UI beyond display
- MegaETH / Monad
- Seed deck polish
- Any funded vault

---

## Calendar

### Tue 25 — kickoff (today)

- N: read CHAIN, LP, FARM, MM, RISK. Sign this order.
- P+Q+U: W1-00, start W1-01 / W1-02.
- Log: this file + BUILD-NOTES day entry.

### Wed 26

- Q: W1-02 limits in sim.
- P: W1-05 Foundry init + mocks.
- U: W1-07 blank quotes + reject copy.

### Thu 27

- Q: W1-03 drills 1–3.
- P: vault reserve math + pause.
- U: W1-04 tick-log, W1-08 gauges.

### Fri 28 — demo day

- Q: drills 4–5 green.
- P: `forge test` green.
- All: 45 min demo. Log the tape.
- L: copy pass (no “yield”).

### Sat–Sun

Optional: notebook on tick log. No deploys.

### Mon 31 — close

- Retro 30 min. Open week 2 (Sepolia mocks only if W1-05 green).
- Anything red stays in week 1; do not start Uni v4.

---

## Tickets

Hours are budgets, not aspirations. Cut scope before cutting tests.

### W1-00  Spec lock  · N+all · 2h

Read [CHAIN.md](./CHAIN.md), [LP.md](./LP.md), [FARM.md](./FARM.md), [MM.md](./MM.md), [RISK.md](./RISK.md), [PROTOCOL.md](./PROTOCOL.md).

**AC:** Slack/log line: “α=0.40, Base, no L1, no naked, 4× IM.” Nick initials in BUILD-NOTES.

### W1-01  DeskEngine + golden tests  · P+Q · 8h

Extract `src/lib/wolfpit/desk-engine.ts` (the interface already sketched in PROTOCOL). Zustand remains the sim adapter.

Golden tests (node:test via `npx tsx --test`, deterministic clock):

| ID | Must |
| --- | --- |
| G1 | Buy call with free ETH = 0 → reject |
| G2 | Buy put with free USDC < K×size → reject |
| G3 | Open long that would push util > 0.40 → reject |
| G4 | Open future IM = 0.25 × size × S |
| G5 | Liquidation when equity < 0.125 × size × S |
| G6 | Hedge 1:1: long N ETH increases reservedETH by N |

**AC:** `npm run test:engine` green (runs `npx tsx --test` over the wolfpit suites). Interface has no `hedgeLater()`.

### W1-02  Remaining RISK limits in sim  · Q · 10h

Not yet in `engine.ts`. Make them hard rejects.

| Limit | Code |
| --- | --- |
| \|Γ\| S² σ² (1h) ≤ 2% NAV | stop writing ATM (return string) |
| \|ν\| ≤ 15% NAV | stop writing |
| OI / expiry ≤ 25% vault ETH | that expiry blank |
| OI / strike ≤ 10% vault ETH | that strike blank |
| Single fill ≤ 10% remaining band | split or reject |
| Circuit: 5m \|ret\| > 3 IV √(5/525600) | halt new shorts 15m |
| Short-call inventory | +0.5 vol-pt on call IV |
| Insurance / NAV < 1% | halt new short gamma |
| Spot fee | `5 + 80*max(0, RV-0.40)` clamp 5–30 |

**AC:** each row has a test. Watchlist shows circuit + halt if live.

### W1-03  Five recorded drills  · Q · 10h

From [RISK.md](./RISK.md). Scripted. Clock 60×. Write `docs/drills/` summaries (markdown, committed) and optional JSON under `artifacts/` (gitignored).

| Drill | Pass |
| --- | --- |
| D1 −20% / 1h, one-sided longs, keepers delayed 2 min | longs liq; insurance ≥ 0; LP USDC drop = posted spread + HE only |
| D2 +40% | no naked call path exists; vault ETH ≥ reservedETH |
| D3 Witching 80% OI ITM | expiry pays from cover; reserved → 0 |
| D4 A shorts, B longs, A scratches | B paid from hedge MTM; LP NAV restored |
| D5 Util → α | next risk-increasing order rejected; spread widens |

**AC:** five markdown reports in `docs/drills/`. Any fail = Friday demo is a fail.

### W1-04  Tick-log export  · U · 4h

Desk: “Export tape” → JSON `{ clock, fills, vault, greeks, iv, rv }`.

**AC:** Quant can replay a session without opening DevTools.

### W1-05  Foundry skeleton  · P · 12h

`contracts/` (Foundry). **Base Sepolia later. No mainnet. No L1.**

- MockUSDC, MockWETH, WPIT (TEST name, cap)
- `DealerVault`: deposit ETH+USDC, shares, `reservedEth`, `reservedUsdc`, `α=0.40`, `pause`
- `writeCall(size)` reverts if `size > freeEth`
- `writePut(size, K)` reverts if `K*size > freeUsdc`
- `openLong(size)` / `openShort(size)` same inventory law
- No Uni v4, no ERC-1155 series yet (week 2)

**AC:** `forge test` covers inventory reverts. README in `contracts/` says TEST, Base, not L1.

### W1-06  Insurance / harvest  · P+Q · 6h

- Harvest farm: 1% tax → insurance
- Halt new short gamma if insurance/NAV < 1%
- Slash order documented in UI copy (stake page): insurance USDC → staked WPIT → pause → LP NAV

**AC:** test harvest tax; stake page sentence matches [FARM.md](./FARM.md).

### W1-07  Blank quotes + reject on ticket  · U · 4h

If `maxNetLongEth=0`, long futures button disabled + reason. Same short, same options. Ticket shows engine string, not “error.”

**AC:** screenshot in build notes. 44px still holds.

### W1-08  Gauge display  · U · 4h

Pools page: weights 70 / 20 / 10, util factor `0.30+0.70U`, ETH-USDC marked **unfarmed**.

**AC:** copy matches [FARM.md](./FARM.md). No APR fireworks.

### W1-09  Chain banner  · U · 2h

`VITE_CHAIN=sim|base-sepolia|base`. Header never silent. Default `sim`.

**AC:** wrong env cannot look like live.

### W1-10  Build-notes ritual  · all · 1h/day

Every day, append to [BUILD-NOTES.md](./BUILD-NOTES.md):

```
## YYYY-MM-DD (Day)
- Done:
- Blocked:
- Tape (α, util, drills):
```

**AC:** no silent days. Friday includes demo notes.

### W1-11  Copy / legal  · L+N · 3h

No “yield,” no “risk-free,” no 10,000% farm. ToS stub on `/` and `/plan` Legal.

**AC:** L initials in the log.

### W1-12  Friday demo  · all · 3h

Script:

1. Reset sim.
2. Buy 2× ATM calls, 2× minis long.
3. 60× clock; force D2 (+40%) narrative (or jump ETH in a debug hook **test-only**).
4. Show reservedETH, insurance, reject of a third call if util binds.
5. `forge test` in terminal.

**AC:** Nick’s notes in BUILD-NOTES. No deploy.

---

## Spec coverage (honest)

| Spec item | Now | Week 1 | Later |
| --- | --- | --- | --- |
| Covered call / cash-secured put | sim | tests + vault skeleton | live |
| α=0.40, 4× IM | sim | golden tests | — |
| RV→IV, put skew | sim | keep | SVI only if OOS wins |
| Book Δ/Γ panel | sim | + circuit | — |
| Insurance seed + liq penalty | sim | harvest tax, 1% halt | TWAP oracles |
| Γ/ν/OI/fill/circuit caps | **missing** | **W1-02** | — |
| Five drills | paper only | **W1-03** | 20% gap on Sepolia |
| Uni v4 hook | no | no | week 2–4 |
| ERC-1155 series | no | no | week 2 |
| Base Sepolia | no | no | week 2 if W1-05 green |
| HL hedge rung | no | no | v2 |

---

## Dependencies

```
W1-00 ─┬─ W1-01 ─ W1-03
       ├─ W1-02 ─┘
       ├─ W1-05 ─ (week 2 Sepolia)
       ├─ W1-04
       ├─ W1-06
       ├─ W1-07
       ├─ W1-08
       └─ W1-09
W1-10 daily
W1-11 by Friday
W1-12 needs 01–03, 05, 07
```

## Escalation

- Drill red on Friday → week 1 extends. No v4.
- Someone wants L1 “just for the TEST token” → no. [CHAIN.md](./CHAIN.md).
- Someone wants to raise α because the tape is busy → no. [TEAM.md](./TEAM.md).
