# Build notes

Append-only. **Newest at top.** Do not rewrite history. Daily standup is three bullets. Specs win arguments.

Ritual: [WEEK1.md](./WEEK1.md) W1-10.

---

## 2026-08-31 (Mon) — audit round-3 fixes (external review)

- HIGH (contracts): `openShort` checked raw `ethBal`, not `freeEth()` — a
  hedge-sell could spend collateral reserved by `writeCall` and leave the
  vault naked (`ethBal < reservedEth`). PoC-confirmed, fixed to
  `size > freeEth() → NakedCall`, regression test added.
- MEDIUM (contracts): `Stake.slash` cut only `total`, not per-user balances —
  first unstaker exited at full pre-slash size, everyone behind was bricked
  by underflow. Rewritten to share-based accounting: slashes land pro-rata
  (as FARM.md always promised), full-slash starts a clean epoch, ABI
  unchanged. Regression tests cover the two-staker slash and the 100%-slash
  epoch reset.
- `creditInsurance` now PULLS real USDC (`transferFrom`) onto a segregated
  ledger — no more unbacked entries that could disarm the 1%-of-NAV halt.
  `reconcileBalances` excludes insurance from the trading balance.
- LP exit path shipped: `withdraw(shares)` burns pro-rata into BOTH legs,
  vault-favoring rounding via the virtual-share offset, and refuses exits
  that would push utilisation past α (reserves can never be stranded).
- Engine: `closeFuture` now crosses the spread (long exits at bid, short at
  ask) like the flatten path — expiry settlement still prints at the mark.
  `addLiquidity` re-anchors k-conservingly via `repinPool` (the old
  `quote = base·mark` rewrite minted/destroyed pool value for existing LPs).
- Store: `placeRaceBet` now sits behind the US geo-fence like futures and
  options (it previously bypassed `gated()` entirely).
- Dead code: `strikes()`, `randn()`, `maxFillEth()`, `SPOT_FEE` deleted;
  internal-only exports un-exported (swap config, risk, engine types,
  preview-origin helper). Planned auth modules kept intact, as before.

## 2026-08-30 (Sun) — audit fixes (external review)

- CRITICAL: option buy-back now paid FROM the house (vault free USDC →
  insurance → recorded hole + circuit) instead of minting the mark. Round
  trip drift 796.94 → 0.0000 (trace-opt). Same honesty for reduceFuture.
- Book: winner drawn weighted by form, so odds (form-based, 1.14 over) are
  fair. Longshot EV +0.601 → −0.123 per stake; favorite −0.402 → −0.132
  (betting-edge, 200k races). Refunded tickets say REFUNDED, not lost;
  short-paid winners get a BOOK SHORT note.
- NAV: vaultNav now marks expired-unsettled options at intrinsic AND the
  vault's counter-party futures PnL (was: −390 expiry transient, stale caps
  between settlements). All 6 conservation checks pass (settled == unsettled).
- OTM call expiry keeps the vault's ETH cover (no forced sale).
- OI-expiry cap nets long/short before the 25% check (no false rejects).
- Keeper: monitor retries with backoff forever instead of exiting on a
  transient RPC error; added `openLong` / `releasePut` / `exec` subcommands.
- Contracts: Stake 7-day unstake cooldown (owner-set, TEST default 0); WPIT
  minter is 2-step with zero-check (can't brick emissions).
- Dead code: 9 files deleted (desk relics, desk-engine, share), 37 deps
  pruned (22 radix, react-hook-form, react-table, sonner, vaul, cmdk,
  react-day-picker, react-resizable-panels, …), ~100 unused exports removed.
- `working` orders fully sanitized on rehydrate (was raw). Dev `admin/admin`
  only when auth is OFF. Equity/emissions decision documented in RISK.md.
- `nf3` @0.3.17 override is Nitro's own transitive dep — deliberately kept.

---

## 2026-08-25 (Tue) — live prices + ToS mobile + Sushi pools

- ETH/BTC from Coinbase → Binance → CoinGecko. Paper: 1000 ETH + 100k USDC.
- Tick no longer GBMs ETH. RV from live candles. AMM x·y=k; create pool UI.
- Desk: Quotes / Chart / Trade / Positions / More.

---

## 2026-08-25 (Tue) — mobile + ops + term copy

- Done: mobile bottom nav, landing seal, “term / vanilla / expiry” not “dated”.
- `/admin` cookie session. Dev id/pw `admin` / `admin`. TEST deploy writes addresses locally.
- Blocked: live Foundry broadcast still Q1 (wallet signer).

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

## 2026-08-30 (Sun) — review-wave fixes, round 2 (external review)

All 14 findings from the second external review (WOLFPIT-REVIEW2.md) are fixed:

- F1 auth lockout DoS: `/api/auth/*` guard is now preflight (read-only) +
  post-dispatch `record(res)` — counters move only on real auth failures
  (>= 400) and reset on success; bare POSTs can no longer lock an account,
  and legit multi-device logins never self-lock.
- F2 slippage divergence: `SLIPPAGE_MIN/MAX_BPS` (1–500) is the single source
  of truth in `config.ts`; the UI clamps custom entries to it (with a
  0.01–5.00% hint) and the server validator uses the same constants.
- F3 stale quote: `execute()` re-fetches the firm quote AFTER the approval
  round-trip and sends (and re-verifies) the fresh one.
- F4 aggregator trust: `assertSafeSwapTarget` pins the approval spender to 0x
  Permit2/AllowanceHolder (per hardfork), requires `tx.to` to be a deployed
  contract, cross-checks the Permit2 spender == tx.to, and validates value +
  calldata shape. Unit-tested (src/lib/swap/safety.test.ts).
- F5 price impact: normalized as PERCENT (0x v2 semantics), values that
  cannot be percents are dropped; the old unverified /100 guess is gone.
- F6 unverified tokens: search results carry `verified`; picker shows
  verified/unverified, swap card warns on unverified legs and on
  transfer/sell tax reported by the aggregator (tokenMetadata now surfaced).
- F7 fee recipient: fee collection is chain-gated (`VITE_FEE_CHAINS`,
  default Base-only) so fees can't land on an uncontrolled address; UI shows
  "None on this chain" elsewhere; /info copy updated.
- F8 rate-limit table growth: bumpCount prunes rows older than the previous
  window; migrations/0003 adds the window_start index (both migrator paths).
- F9 IP trust: `clientIp` prefers cf-connecting-ip over x-forwarded-for.
- F10 0x quota DoS: spotQuote (120/min) and searchChainTokens (60/min) are
  throttled per IP via the shared DB (fail-open), the token picker skips
  one-char non-address queries, and search reuses cached PREFIX results
  (filtered locally) instead of hitting upstream per keystroke.
- F11 receipt wait bounded: waitForReceipt returns success/reverted/timeout
  after 120 s; UI explains the timeout instead of spinning forever.
- F12 dead code: switchToBase (already removed in the round-1 commit) had a
  stale doc comment — cleaned.
- F13 env validation: quote.server gates on `FEE_ENABLED` (valid address)
  instead of truthiness.
- F14 degenerate pairs: per-chain curated default buy tokens (USDC on the
  majors) so a non-Base chain never opens as sell==buy; the toggle label and
  dock hint now say "on-chain / 16 chains" instead of Base-only.

Tests: rate-limit suite 13/13 (new auth-guard tests incl. reset-on-success,
failure-only counting, pruning), swap safety suite 11/11, engine 87/87,
forge 36/36, cargo 11/11, tsc/eslint/build clean.
