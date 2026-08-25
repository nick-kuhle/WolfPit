# Build notes

Append-only. **Newest at top.** Do not rewrite history. Daily standup is three bullets. Specs win arguments.

Ritual: [WEEK1.md](./WEEK1.md) W1-10.

---

## 2026-08-25 (Tue) — brand polish + Alloy keeper

- Done:
  - Landing pit plate, three doors (desk/pools/stake). LP remove, option close, harvest tax on pools.
  - Contracts: WPIT, SimplePair, Farm, Stake, Deployer. Insurance halt on vault.
  - Alloy 2.x keeper `crates/keeper` (calldata + optional RPC).
  - `docs/DEV.md`, `.env.example`, Makefile.
- Blocked: waiting on nick-kuhle/WolfPit PAT.
- Tape: still sim. Ready to push v0.1.1 when Nick opens the repo.

---

## 2026-08-25 (Tue) — Q1 scoped + v0.1 on WPplans

- Done:
  - v0.1 pushed to `nick-kuhle/WPplans` @ `2ef9f66`.
  - Q1 workload (1 Sep–30 Nov): [Q1.md](./Q1.md). ~1,650h scheduled. Sepolia unfunded TEST. No mainnet vault.
- Blocked: P/Q/U named seats. Hook waits on hire or P owns it.
- Tape: still sim. Next demo is Sep (D4 netting + 1155 naked revert).

---

## 2026-08-25 (Tue) — Week 1 closed (sim v0.1)

- Done:
  - W1-00 spec lock in code: α=0.40, Base, no L1, no naked, 4× IM.
  - W1-01 DeskEngine interface + golden G1–G6 (`npm run test:engine`).
  - W1-02 RISK limits in `engine.ts` / `risk.ts`: Γ cash, ν, OI expiry/strike, 10% fill band, 5m circuit, +0.5 vol-pt, insurance/NAV halt, spot fee 5–30.
  - W1-03 drills D1–D5 recorded in `docs/drills/`. All pass.
  - W1-04 Export tape on the desk.
  - W1-05 Foundry `contracts/` DealerVault. `forge test` 8/8. No Uni v4.
  - W1-06 Harvest 1% tax → insurance. Slash copy on Stake.
  - W1-07 Blank quotes + reject string on the ticket / chain.
  - W1-08 Gauges 70/20/10. ETH-USDC unfarmed.
  - W1-09 `VITE_CHAIN=sim|base-sepolia|base`. Header never silent. Default sim.
  - W1-11 ToS stub. No yield / risk-free / 10,000% copy.
  - W1-12 Demo = the five drills + forge. No deploy.
- Tape:
  - Engine tests 22/22. Forge 8/8.
  - Γ/ν caps are in code; on a 100 ETH vault they are dominated by OI 25% and the 10% fill band. That is correct, not a skip.
  - D4 pays B from the paper account credit (~$1,000 on 1 ETH 3000→4000). Cover restored. Full vault-debit MTM netting stays week 2 if we want LP NAV to move 1:1 with trader wins.
- Blocked: none for v0.1 sim. Ready for `nick-kuhle/WolfPit` when Nick sends a new PAT.
- Nick initials: _pending on this close line._

---

## 2026-08-25 (Tue) — brand

- Done:
  - Pit mark: concentric octagon + stamp wolf. Bone `#e6e2d6`, brass inner ring `#c4a15c`.
  - Files in `public/brand/` (svg + seal/lockup/og rasters + icon-512). Favicon and `WolfMark` updated.
  - Spec: `docs/BRAND.md`.
- Blocked: none.
- Tape: still sim. No deploy.

---

## 2026-08-25 (Tue) — Week 1 kickoff

- Done:
  - Specs read and locked: CHAIN, LP, FARM, MM, RISK, PROTOCOL.
  - Week 1 work order written (`docs/WEEK1.md`).
  - Prior: paper desk, Base (not L1), RV→IV, put skew, insurance $25k seed, Δ/Γ rail, 4× IM, α=40%, util-weighted farm, GitHub `nick-kuhle/WPplans` @ `d9c683f`.
- Blocked:
  - Seats P/Q/U/L may still be empty. Tickets stay assigned to the **role**. Nick parks or covers.
  - PAT for GitHub: revoke after this push if still live.
- Tape:
  - α = 0.40 signed in spec. Not in production.
  - Sim only. `wolfpit-sim-v3`.
  - RISK limits still **missing** in engine: Γ cash cap, vega cap, OI/expiry, OI/strike, 10% fill band, 5m circuit, +0.5 vol-pt inventory, insurance/NAV halt. That is W1-02.
  - Five drills not recorded. That is W1-03.
  - No Foundry tree. That is W1-05.
- Nick:
  - Initials: _pending_ (read WEEK1, reply in this log).

### Already shipped (same day, before this order)

| Item | Where |
| --- | --- |
| Paper desk (spot, mini fut, mini opt) | `/trade` |
| TEST pool names | ETH-USDC, WPIT-USDC-TEST, WPIT-ETH-TEST |
| Covered / cash-secured only | `engine.ts` |
| Hedge 1:1, reject if no inventory | `engine.ts` |
| Chain decision Base | `docs/CHAIN.md` |
| LP / farm / MM / risk specs | `docs/LP.md` `FARM.md` `MM.md` `RISK.md` |
| Header `Sim · Base` | `shell.tsx` |

### Do not do tomorrow

Deploy anything. Uni v4. Hyperliquid. Raise α.

---

## Template (copy for each day)

```
## YYYY-MM-DD (Day)

- Done:
  -
- Blocked:
  -
- Tape (α, util, drills, forge):
  -
```
