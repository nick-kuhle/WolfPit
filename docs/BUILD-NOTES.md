# Build notes

Append-only. **Newest at top.** Do not rewrite history. Daily standup is three bullets. Specs win arguments.

Ritual: [WEEK1.md](./WEEK1.md) W1-10.

---

## 2026-08-31 (Mon) — live swap chart drew a fabricated series for any non-CEX token

Reported from production (`wolfpit-protocol.vercel.app`): selling ETH for
**Basecat** on `/trade?mode=live` showed a chart headed "ETH / Basecat" wandering
around 1.00 with a `sim · indicative` badge, while `?mode=sim` showed the real
Basecat candles for the same token.

Two defects, both in `src/components/swap/swap-chart.tsx`:

1. **No routing metadata on the candle request.** It called
   `loadSymbolCandles({ symbol })`. That helper can only reach a feed it is told
   how to reach — a CEX pair from its symbol maps, a CoinGecko id, or
   `network` + `poolAddress`. The simulation desk (`desk.tsx`) passes all four
   because its `Listing` rows come from the GeckoTerminal tape / DexScreener
   search and already carry the pool; the swap desk passed none. Measured
   against the live APIs before the fix:
   `{ symbol: "Basecat" }` → **0 bars**;
   `{ symbol: "Basecat", network: "base", poolAddress: "0xf794…8944" }` → **200 bars**.
   With zero bars the component fell into `synthCandles(1, …)` — a random walk
   anchored at 1.00. It was not failing to load; it was drawing fiction.
2. **The sell leg was the chart subject.** ETH → Basecat charted ETH, so even a
   working feed would not have shown the token being bought.

Fix — new `src/lib/swap/chart-feed.ts`:

- `pickSubject()` ranks legs (long-tail 2 > major 1 > stable 0, ties to the sell
  leg) so the chart follows the token the user is taking a view on.
- `resolveTokenFeed()` resolves a token CONTRACT to its deepest pool:
  chainId → GeckoTerminal slug → `/tokens/{addr}/pools` → DexScreener fallback,
  memoized 10 min. `pickPool()` only accepts pools where our token is the
  **base** token — GeckoTerminal OHLCV reports the base token's price, so
  charting a pool where the token is the quote side would draw the *other*
  token's price.
- No feed anywhere returns `source: "none"`; the chart then draws an indicative
  series anchored at the best real price it holds (resolver spot, else the
  quote-implied USD) and badges it — never 1.00, and never badged while the real
  series is still loading.
- The series is now the subject's **USD** price, the same series the simulation
  desk draws for that token, and the executable pair rate gets its own labelled
  line (`ChartCard note`) instead of sharing the headline slot.

Also: `loadSymbolCandles` memoized candle jobs **forever**, so a live chart kept
the bars it fetched on mount for as long as the tab stayed open. Now a 60 s TTL,
and the swap chart re-pulls on that cadence.

Verified end-to-end against the live APIs: ETH→Basecat and Basecat→ETH both
resolve `geckoterminal`/`base`/`0xf794…8944` → 200 bars, last 0.02774;
ETH↔USDC → 350 bars from the symbol feed; an unlisted contract → 0 bars,
`source: "none"` (no invented pool). `tsc` clean · eslint clean · `npm test`
**228 pass / 0 fail** (36 + 61 + 131; +9 new in `chart-feed.test.ts`) ·
`npm run build` exit 0. No Solidity touched, so no forge run.

---

## 2026-08-31 (Mon) — HOOK.md RV spec realigned to math.ts (F3 follow-up)

`70ae20f` (F1–F9) pinned `λ = 0.94, τ = 60 s` in `HOOK.md` §5.1 with the note
"per math.ts". That λ is the defect reported in issue #25 / M-02, and the fix in
`915467b` changed `math.ts` to derive λ from a stated half-life — so the spec and
the reference implementation disagreed. Spec-only change; no code touched.

- **λ**: `0.94` → `0.9971161`, now written as `λ = 0.5^(τ/halfLife)` with
  `halfLife = 14400 s` (4 h) so the window is derived rather than hard-coded.
  Half-life verified at exactly 240.000 min; effective window `1/(1−λ) ≈ 347` bars.
  F3's contribution is preserved unchanged — `λ_eff = λ^(Δt/τ)` still makes decay
  time-weighted, so swap cadence cannot inflate RV. Only the constant changed.
- **`√(π/2)` added to the annualization** — this was a second parity gap, not part of
  F3. The hook accumulates `|ln(P/P)|`, whose expectation is `E|r| = σ·√(2/π)`, not σ.
  Annualizing it raw under-reports vol by 20.2%, making `IV_atm = 1.08·RV` a 13.8%
  discount on a structurally short-gamma book — issue #20 / M-01 reintroduced on-chain.
  Folded constant `√(π/2)·√525960 ≈ 908.9423`. `math.ts` is the reference and already
  applies this.
- §12 sign-off row updated to match.

The binding constraint on RV quality is still `CANDLE_LIMITS.MAX = 300` (≈ 5 h of
tape) — worth its own issue, since no λ compensates for a 5-hour window.

---

## 2026-08-31 (Mon) — issue triage: 13 fixes, 6 confirmed already-closed

Worked all 28 open issues. The reviewer's own re-verification ran at `8d9e0b5`,
four commits behind HEAD — `8ab4119`, `a31e77c`, `c33c054`, `fc7d8e3` had
already closed four of the five criticals. Re-checked every finding against
current source rather than trusting the report.

- **Already fixed at HEAD, confirmed by reading the code (not the log):** WP-01
  (`SimplePair` first-add counts supply once), WP-02 (`Stake` share-based,
  slash is pro rata), WP-03 (`withdraw`/`previewWithdraw`/`maxWithdraw` exist),
  WP-11 (`creditInsurance` pulls real USDC).
- **Quant (M-01…M-09), all pinned by `src/lib/wolfpit/quant.test.ts`:**
  - `ewmaRv` was reporting `E|r|`, not σ — measured **0.7992σ** at a known
    σ=0.60 over 1,500 GBM paths, exactly √(2/π). Now scaled by `MAD_TO_SIGMA`
    = √(π/2); measured **1.0017σ**. `IV = 1.08·rv` was a 13.8% *discount* on a
    structurally short-gamma book; it is a premium again.
  - λ is now derived from a stated half-life (`ewmaLambda(barSec, halfLifeMin)`,
    default 4 h) instead of inheriting RiskMetrics' daily-bar 0.94, which is a
    17-minute memory on 1-minute bars.
  - **Rejected the 17-day λ the review proposed.** Lengthening λ without
    lengthening the history makes dispersion worse, not better: measured
    p05–p95 at known σ is 235%σ on 5 h of tape and still 212%σ on 48 h — worse
    than λ=0.94 at every history length tested. Real fix is a longer bar
    history; table recorded in `docs/MM.md`.
  - `insuranceRatio` returns **0** on `nav <= 0` (was `1` = "fully insured" at
    the moment of insolvency), matching `DealerVault.haltShortGamma`.
  - Limits now bind the **realised average**: CPMM algebra inverted so a limit
    partial-fills to the limit instead of over-filling. The review's 500-ETH
    case printed 5015.05 against a 4000 limit; at limit 4100 it now fills
    53.64 ETH at exactly 4100.00.
  - One `freeVaultUsdc()` across five call sites — trader escrow no longer
    cash-secures house puts.
  - `Z99 = 2.5758` (two-sided; the review's "18.4% too low" is really 22.6%).
  - Resting orders append (time priority) and the 41st is rejected rather than
    silently evicting the oldest.
  - `gammaCash1h` documented as 2× textbook (deliberate safety factor on
    `GAMMA_NAV`); `bsPut` guards NaN like `bsCall`.
- **Contracts:** `ERC20Base` (emits `Transfer`/`Approval` — WPIT inherited
  `MockERC20`, which emitted neither, so indexers and exchange deposit
  crediting could not see it move), `SafeERC20` (no discarded return values),
  `TestERC20` replacing `MockERC20` in `Deployer`, `SimplePair` typed `IERC20`
  with `minOut`/`deadline` on all four value paths and a `swap1for0`,
  `Farm.totalShareBps` capped at 10 000, `acceptMinter` rejects a null
  proposal. Deadline sentinel is `type(uint256).max`, not 0 — `block.timestamp`
  can legitimately be 0/1 and an expired deadline must be representable.
- **Keeper:** `--key` removed from the CLI (env only, plus `--key-file`); buffer
  zeroized once the signer owns it.
- **Docs:** README no longer claims "simulation only" — the swap desk builds
  live Base mainnet transactions — and now states the owner/operator trust
  model plainly. `MM.md` / `RISK.md` record the vol and z conventions.
- **Deferred, with reasons:** OpenZeppelin vendoring (#4) — the suite is
  forge-std-free and hand-rolled cheatcode interfaces; revisit before mainnet.
  Server-side pause/geo-fence (#13) — the surfaces it gates are themselves
  client-side simulation, so the control is cosmetic until orders are accepted
  server-side; the live `spotQuote` path is the one that actually needs it.
  Timelock + `exec` selector allowlist (#12).
- Tape: forge 55 → **70**, cargo 11 → **13**, engine/auth/swap 171 → **198**.
  tsc, eslint, `clippy -D warnings`, `npm run build` all clean.

---

## 2026-08-31 (Mon) — v4 hook spec corrections (F1–F9, external review)

External review of `HOOK.md` (c33c054) found fee-parity and v4-mechanics issues.
Spec-only fixes — no engine/risk/contract logic change.

- F1 (HIGH): `_dynamicFee` returned the fee in bps units; v4 fees are **pips**
  (hundredths of a bip — `LPFeeLibrary.MAX_LP_FEE = 1_000_000` = 100%). Returning
  `5–30` charged 0.0005%–0.003%, 100× too low. Now `feeBps * 100` (`[500,3000]`).
- F2 (HIGH): `beforeSwap` returned a bare fee without `OVERRIDE_FEE_FLAG` — the Pool
  falls back to its stored fee, so the dynamic fee never applied. Now
  `fee | OVERRIDE_FEE_FLAG`; §2 corrected (v4 has no "floor + dynamic" composition —
  the returned fee REPLACES the stored fee for that swap; dynamic pool initialized
  with `DYNAMIC_FEE_FLAG`).
- F3 (MEDIUM): RV was event-sampled but annualized with a calendar constant, making
  the fee a swap-frequency gauge. Now a **time-weighted EWMA**
  (`λ_eff = λ^(Δt/τ)`, τ = 60 s) annualized with `√(365.25·24·3600/τ) = √525960` and
  clamped `[0.15, 2]` — sim parity at any swap cadence (`ewmaRv` measures actual bar
  spacing).
- F4 (LOW): sim `spotFeeBps` rounds (`Math.round`); the hook floored. Now
  round-half-up (`+0.5e18`), matching the sim at sub-bps boundaries.
- F5 (LOW): on-chain RV cold-start seed undefined. Pinned `0.55` (annualized) until
  ≥ 8 observations — sim parity (`ewmaRv` seeds 0.55 below 8 candles).
- F6 (nit): T2's `RV≥0.875 → 30` mislabeled the kink; the formula saturates at
  `RV = 0.7125`. T2 now pins the true saturation point and asserts `fee.isOverride()`.
- F7 (nit): §4 pushed depth via `setPoolDepth` while §8 chose pull. §4 rewritten to
  pull: `reconcileDepth()` (`onlyOperator`, idempotent) reads the hook's `lastDepth`;
  the push surface (`IWolfPitDepthSink`) is removed.
- F8 (nit): "write-once-per-block" claim had no guard; reworded — idempotent
  overwrites, with the vol same-block collapse (I9) the only cadence guard.
- F9 (nit): `beforeSwap` `view` was premised on staticcall; v4 uses `call`. Reworded:
  `view` is a self-imposed guarantee, kept.

Spec-only (no logic change): suites unchanged at HEAD (forge 55/55, npm 171/171,
cargo 11/11).

## 2026-08-31 (Mon) — v4 hook spec (Q1-05) + admin env fix

- `contracts/HOOK.md` written (Q1-05, spec-only, no deploy): the Uni v4 hook is
  the **depth lens + listing oracle + dynamic-fee hook** for the ETH/USDC pool on
  Base. Covers `Hooks.Permissions` (all `*ReturnDelta` false — the hook holds no
  position/earns no delta), the `setPoolDepth` vault surface (`onlyHook`,
  fail-closed to zero on stale depth), `fee = 5+80·max(0,RV−0.40)` clamp 5–30 from
  an on-chain EWMA vol accumulator (λ=0.94, same-block collapse so a flash-loop
  can't forge vol), the **cover-never-concentrated** rule (cover = idle vault ETH
  only; pool depth is never cover), I1–I10 hard invariants, and the pull-vs-push
  decision (keeper reconcile; the hook never calls the vault synchronously so it
  can't revert a user swap). Fork-test plan T1–T10, "why not v1" list, review
  sign-off table for Q.
- Linked from `docs/README.md` + `contracts/README.md`.
- **Admin login root cause found and fixed** (the earlier note blamed a Node-20
  install; the pglite store was healthy — this was the actual cause). TanStack
  Start's SSR handler (`@tanstack/start-server-core` `createStartHandler`) gates
  server-function routing on `SERVER_FN_BASE = process.env.TSS_SERVER_FN_BASE`.
  In dev that value is NOT auto-injected into the node process, so it was
  `undefined` — every `createServerFn` POST (admin login, swap quotes, auth) fell
  through to the HTML router and 500'd "Only HTML requests are supported here";
  the clients' `.catch`-less `void fn()` calls swallowed it, so the UI appeared to
  do nothing. Fix: `scripts/with-app-env.mjs` now injects
  `SSR_ENV_DEFAULTS = { TSS_SERVER_FN_BASE: "/_serverFn/", TSS_ROUTER_BASEPATH: "/" }`
  (mirrors the plugin's default `serverFns.base` join), merged below file/process
  env so an explicit override wins. Verified end-to-end over HTTP: `POST
  /_serverFn/<id>` with the browser's seroval body → 200 `{ok:true,user:"admin"}` +
  sets the `wp_admin` HttpOnly SameSite=Lax 12h cookie; `adminWhoami` reads
  `user:"admin"` with the cookie / `null` without; `/admin` redirects when
  unauthenticated. `scripts/with-app-env.test.mjs` 12/12, typecheck clean, npm
  test 96/96 engine.

## 2026-08-31 (Mon) — review follow-ups round 4 (C1 + doc drift)

- C1 (contracts, DealerVault): `pause` was `onlyOwner` while the Rust keeper
  signs as the OPERATOR — a fail-closed on-chain halt in production reverted
  `NotOwner`. Now `onlyOperator` (owner still passes): the keeper can halt the
  pit and resume via its manual `Pause{v}` command; a third party stays locked
  out. Pausing stops new risk (the `live` gate); safe LP withdrawals remain
  available while paused. Regression tests: operator fail-closed pause +
  resume, owner pause, third-party reject (`NotOperator`).
- Docs drift closed:
  - `contracts/README.md` deploy command pointed at the nonexistent
    `script/Deploy.s.sol` → `script/DeployBase.s.sol` (the script
    DEPLOY-BASE.md documents; Sepolia dry-runs need `BASE_ALLOW_ANY_CHAIN=1`).
  - `docs/WEEK1.md` told readers to run vitest → the repo runs `npx tsx --test`
    (`npm run test:engine`).
- Tests: forge 55/55 (was 54), engine 96/96, npm test 171/171, cargo 11/11,
  tsc/eslint/build clean.

## 2026-08-31 (Mon) — audit B1/B2/B3 fixes

- HIGH (contracts, SimplePair): first `add` double-counted `lpSupply` — the
  branch set `lpSupply = a0` and then the shared `lpSupply += shares` tail ran
  again, so total supply was ~2·a0 and a first LP clawed back only ~half their
  deposit on a round-trip (later adds were over-credited against the inflated
  supply). Fix: the burn is seeded as `lpSupply = MINIMUM_LIQUIDITY` (V2-style,
  counted exactly once), so total supply = burn + shares = a0. Round-trip
  regression test added (pins supply == a0 and ~full return; the burn is the
  only intended cost).
- HIGH (contracts, Deployer): the token-era deploy path was bricked — Deployer
  called owner-gated `vault.setWpitFeeder` while the vault's owner was the
  external deployer (`NotOwner`), and even past that, `setStake` was never
  wired so `slashInsuranceJunior` always reverted `Zero()`. Fix: Deployer is
  the vault's owner during construction (factory pattern), wires `setWpitFeeder`
  AND `setStake`, then hands ownership back via the vault's two-step transfer
  (`vault.acceptOwnership()` completes it; operator is the deployer from the
  start). Deployer-path tests added: full stake → slash loop through the
  deployed contracts, plus the vault-only launch-shape check.
- MEDIUM (contracts, DealerVault): `openShort` now enforces the same cover
  floors as `exec` — after the router call, real balances must still back
  `insuranceUsdc` (`InsuranceSpent`) and the reserved book (`CoverSpent`, USDC
  and WETH). Pre-fix a buggy/compromised hedge router holding a USDC allowance
  could spend the reserve and the tx died with a raw arithmetic-underflow panic
  instead of an explicit error. Regression test asserts the explicit
  `InsuranceSpent` selector.
- Tests: forge +4 (50 → 54). All suites green, tsc / eslint --quiet / build
  clean. (Note: `npm test`'s rate-limit suite SIGKILLs under heavy memory
  pressure in low-RAM sandboxes — PGLite/WASM; green with headroom.)

## 2026-08-31 (Mon) — review follow-ups (round-3 residue)

- Contracts:
  - `openShort` now re-checks the ETH side of the α law after the swap
    (`reservedEth ≤ α·ethBal`), not just the USDC side — a hedge-sale
    shrinks the cover pool that backs written calls / long futures, so at
    util = α no further hedge-sale can compress it (regression tests for the
    reject at the cap and the allowed-with-headroom path).
  - `exec` now enforces full cover floors after any allowlisted router call:
    insurance USDC (`InsuranceSpent`, existing), trading USDC ≥ `reservedUsdc`
    and WETH ≥ `reservedEth` (new `CoverSpent`) — the round-3 insurance guard
    alone would still have let a router drain WETH from under written calls or
    trading USDC from under cash-secured puts. Drain-router tests for both.
  - New `maxWithdraw(who)`: the largest exit that keeps BOTH legs inside α
    (exact to the share — the max passes, one more share reverts). At the α
    cap it returns 0: LPs cannot exit until utilisation falls (exit queues are
    v1.1). Tested at cap / flat / boundary.
- Contracts (Stake): `_wipeIfEmpty` now also wipes below a dust threshold
  (`DUST = 1e-6 WPIT`) — a near-full slash leaving 1 wei previously kept a
  near-zero `total` with a huge share ledger, letting the next stake mint
  astronomical share counts. Dust-wipe test added.
- Engine:
  - `closeFuture` (early close) now charges the same `DERIV_FEE` as opens and
    flattens (F9 parity), split vault/insurance by `takeFee`; settlement
    prints stay fee-free. The Close button is no longer strictly cheaper than
    flattening.
  - `removeLiquidity` re-anchors k-conservingly to the live mark (parity with
    the round-3 `addLiquidity` fix) so exits never price off a stale pool
    print.
  - Sim `applyVaultOpen` short path enforces the ETH-side α law (contract
    parity with `openShort`).
- Tests: engine +4 (92 → 96), forge +6 (44 → 50). All suites green, tsc /
  eslint --quiet / build clean.

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
