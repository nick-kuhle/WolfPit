# WolfPit Uniswap v4 hook — spec (v1.0, no deploy)

> **Status:** SPEC ONLY. Q1-05. No deploy. Reviewed by Q (Head of Quant) before implementation.
> Q1-12 (implementation) must not weaken anything here. If the implementation needs a
> looser limit, the spec changes first and Q signs off.
>
> **Place in the stack:** this hook is the **listing oracle + depth lens** for the
> ETH/USDC pit pool. It is **not** the dealer vault and **not** the market maker. It
> exists so the vault can answer two questions cheaply on every pool touch: *how deep
> is the book right now?* and *what should the spot fee be?*

---

## 0. TL;DR / what it is

A single Uniswap v4 hook deployed on the **ETH/USDC** pool on **Base** (Sepolia first):

1. **`afterSwap` / `afterAddLiquidity`** report realized pool depth (base + quote
   reserves) into the `DealerVault`, so the vault can size quotes, enforce the
   `α=0.40` inventory law, and never book a fill it cannot hedge.
2. **`beforeSwap`** returns a **dynamic fee** `fee = 5 + 80·max(0, RV − 0.40)`
   clamped to `[5, 30]` bps, driven by an on-chain realized-vol estimate.
3. **The hook can never let the vault go naked.** It carries no token balances of
   its own except the transient `BalanceDelta` it is allowed to keep; it is not a
   dealer, holds no position, and every path that would let the vault over-commit
   is rejected in the vault, not silently absorbed by the hook.

**Explicitly NOT the hook's job:** quoting options/futures, holding inventory,
hedging, minting, pause keys, settlement. All of that lives in `DealerVault` /
keepers / the desk engine.

---

## 1. Design goals (from LP.md / MM.md / RISK.md / Q1-05)

| Goal | Where it shows up in this spec |
| --- | --- |
| Pool depth is the ONLY listing oracle | §3, §4 (pull: keeper `reconcileDepth` → `poolDepthBase` / `poolDepthQuote`) |
| Dynamic fee `5+80·max(0,RV−0.40)` clamp 5–30 | §5 (`beforeSwap`) |
| Cover never concentrated | §6 (`coverWeight` / `concentrated != cover`) |
| Hook cannot let vault go naked | §7 (invariant & fail-closed rules) |
| No `hedgeLater()` | §7 — a fill the vault cannot cover **now** is rejected, never queued |
| Gas is hedge error | §8, §9 — callback work must be O(1) and bounded; no unbounded loops |

---

## 2. Chain / asset facts

| | |
| --- | --- |
| Chain | **Base** (chain id `8453`). Sepolia `84532` for Q1 dry-runs. |
| Pool | `WETH / USDC` v4 pool. WETH is `currency0` (address `0x4200…0006`), USDC is `currency1` (`0x8335…2913`). `CurrencyLibrary.isNative()`/`isAddressZero()` must NOT be relied on — WETH is an ERC-20 here, not native ETH. Sort explicitly by address. |
| Fee tier | The pool is a **dynamic-fee pool**: initialize with `LPFeeLibrary.DYNAMIC_FEE_FLAG` (`0x800000`). v4 has **no "floor + dynamic" composition** — the fee `beforeSwap` returns (with `OVERRIDE_FEE_FLAG` set, see §5) **replaces** the stored fee for that swap. |
| Tick spacing | `60` (0.30% tier). Wrapper uses the canonical `PoolKey` for the pool id (`PoolIdLibrary`). |
| Vault | `DealerVault` at an env-provided address. See `contracts/src/DealerVault.sol`. |

> **Do not** deploy the hook onto a pool whose WETH is treated as native, and do not
> hardcode "token0 is ETH" — the current `PointsHook`-style examples assume
> `currency0.isNative()`. On Base the canonical WETH/USDC pool's ordering is
> **address-sorted**, so the hook must branch on the actual currency addresses.

---

## 3. Hook flags / permissions

The hook implements exactly the callbacks it needs. `Hooks.Permissions`:

| Callback | Set? | Purpose |
| --- | --- | --- |
| `beforeInitialize` | no | |
| `afterInitialize` | no | |
| `beforeAddLiquidity` | no | |
| `afterAddLiquidity` | **yes** | report depth after liquidity moves |
| `beforeRemoveLiquidity` | no | |
| `afterRemoveLiquidity` | **yes** | report depth after liquidity leaves (depth drops) |
| `beforeSwap` | **yes** | return the dynamic fee |
| `afterSwap` | **yes** | report depth after a swap; update the vol/EWMA accumulator |
| `beforeDonate` / `afterDonate` | no | |
| `beforeSwapReturnDelta` / `afterSwapReturnDelta` | **no** | the hook keeps **no** trade delta |
| `afterAddLiquidityReturnDelta` / `afterRemoveLiquidityReturnDelta` | **no** | the hook keeps **no** liquidity delta |

> The two `*ReturnDelta` flags MUST stay **false**. The hook never earns a token
> delta; it only observes. Keeping a positive hook delta would let it accumulate a
> position, which is exactly the "hook is a dealer" failure mode. `afterAddLiquidity`
> and `afterRemoveLiquidity` return `BalanceDelta.wrap(0)` (the LP's own delta is
> returned by the PoolManager; the hook echoes nothing).

Deployment address must carry the flag bits for `afterAddLiquidity`,
`afterRemoveLiquidity`, `beforeSwap`, `afterSwap`. Use the `Hooks` library's
`*_FLAG` constants with the namespace offset pattern, e.g.
`uint160(Hooks.AFTER_ADD_LIQUIDITY_FLAG | Hooks.AFTER_REMOVE_LIQUIDITY_FLAG | Hooks.BEFORE_SWAP_FLAG | Hooks.AFTER_SWAP_FLAG) ^ (0x7777 << 144)`.
Never reuse the namespace of another WolfPit hook.

---

## 4. Interface contract between hook and vault

The vault exposes a **single, minimally-privileged** depth entry point the keeper
calls, plus reads the hook for the current fee. Only these — no other vault state is
written by the hook. **PULL model (see §8): the hook never calls the vault** — it
stores its observations and the keeper pulls them in.

### Vault additions (new in Q1-12)

```solidity
// DealerVault.sol (new, minimal surface)
IWolfPitHook public pitHook;               // verified non-zero at wiring
uint256 public poolDepthBase;              // base-side depth in 18-dec WETH units
uint256 public poolDepthQuote;             // quote-side depth in USDC units (6-dec)
uint256 public lastDepthAt;                // block.timestamp of last report
bytes32 public lastDepthBlock;             // blockhash for staleness (optional)

error DepthStale(uint256 age);

/// @notice onlyOperator (keeper). Pulls the hook's last observed depth into the
///         vault — the hook is never called by the vault and never writes it
///         synchronously, so a vault bug can never revert a user's pool action.
///         Idempotent (plain overwrites): call after a pool touch or on the
///         keeper cadence.
function reconcileDepth() external onlyOperator nonReentrant {
    (uint256 b, uint256 q) = pitHook.lastDepth();
    poolDepthBase = b;
    poolDepthQuote = q;
    lastDepthAt = block.timestamp;
    lastDepthBlock = blockhash(block.number - 1);
    emit PoolDepth(b, q, lastDepthAt);
}
```

```solidity
// readonly surface the hook exposes (used by the desk / keeper)
interface IWolfPitHook {
    function poolKey() external view returns (PoolKey memory);
    function currentFee() external view returns (uint24);       // last returned fee, pips
    function rv() external view returns (uint256);              // 18-dec annualized RV
    function iv() external view returns (uint256);              // 1.08·rv, clamped
    function lastDepth() external view returns (uint256 base, uint256 quote);
    function observedAt() external view returns (uint40);       // tick obs timestamp
}
```

Rules on the vault side:

- `reconcileDepth` is `onlyOperator` + `nonReentrant` and idempotent — no
  once-per-block guard needed on the vault; the hook's same-block vol collapse (I9)
  is the only cadence guard in the system.
- The vault **reads depth, never assumes it**. The desk/keeper always reconciles
  `poolDepth*` against the *oracle mark* and the pool's own `liquidity` before
  sizing (see §6). A stale report (`lastDepthAt` older than N blocks) must be treated
  as **zero usable depth** — fail-closed, do not book.
- **The hook does NOT and CANNOT touch `reservedEth` / `reservedUsdc` / `ethBal` /
  `usdcBal` / `haltShortGamma`.** `haltShortGamma()` logic stays inside the vault.

---

## 5. Dynamic fee (RV-driven)

`MM.md / LP.md`:
`fee_bps = 5 + 80 · max(0, RV − 0.40)`, clamped `[5, 30]`.

### 5.1 Where RV comes from (on-chain, tamper-aware)

RV must **not** be a caller-supplied argument to `beforeSwap` — that would let a
flash-loan-borrower set the fee. It is a pool-observation accumulator updated only
inside `afterSwap`:

```
RV_t       = λ_eff · RV_{t-1} + (1 − λ_eff) · |ln(P_t / P_{t-1})|
λ_eff      = λ^(Δt / τ),  λ = 0.94,  τ = 60 s   (RiskMetrics EWMA, per math.ts)
P_t        = sqrt-price at the tick of the current observation
RV_annual  = clamp(RV_t · √(365.25·24·3600 / τ), 0.15, 2)   (= RV_t · √525960)
```

- Each `afterSwap` records the new observation **only after** the pool state is final
  (the hook receives `delta` post-swap). Two consecutive observations inside the same
  block are collapsed: keep the first, ignore the second, so a single block cannot
  fabricate vol.
- **Time-weighted, not event-weighted:** the EWMA decay uses the wall-clock Δt
  between observations (`λ_eff = λ^(Δt/60s)`). A swap every 60 s reproduces the sim's
  `ewmaRv` exactly; dense swapping decays the accumulator faster and quiet periods
  slower, so swap cadence can never inflate RV. Annualization is always `√525960`
  (the 60 s reference bar), matching `ewmaRv`'s per-bar basis.
- **Cold start (sim parity):** until ≥ 8 observations the hook reports
  `rv() = 0.55e18` (annualized → fee 17 bps) — `ewmaRv` seeds 0.55 below 8 candles.
  The accumulator initializes at the 8th observation (first return, the sim's `n == 0`
  branch), then runs the EWMA.
- The EWMA is constant-work; a running `rv` accumulator plus one ring buffer of
  observations (e.g. the last 4) is enough. **No unbounded array, no per-swap gas bomb.**
- `IV` (for the vault's Γ/ν/option caps and the desk's smile) is computed from the same
  RV: `IV_atm = clamp(1.08 · RV, 0.28, 1.60)`. This is **display + risk** only; the
  hook itself only returns the **fee**. The vault keeps its own `iv` getter read from
  the hook.

### 5.2 Fee override mechanics

```solidity
function beforeSwap(
    address,
    PoolKey calldata key,
    IPoolManager.SwapParams calldata,
    bytes calldata
) external view override onlyPoolManager returns (bytes4, BeforeSwapDelta, uint24) {
    // Dynamic fee: the pool is a dynamic-fee pool, and the returned uint24 REPLACES
    // the stored fee for THIS swap (v4 has no floor + dynamic composition). The
    // OVERRIDE_FEE_FLAG must be set or the Pool falls back to its stored fee and the
    // dynamic fee silently never applies. Fee unit is pips: hundredths of a bip
    // (1 pip = 0.0001%; LPFeeLibrary.MAX_LP_FEE = 1_000_000 = 100%).
    uint24 fee = _dynamicFee(rv());
    return (BaseHook.beforeSwap.selector, BeforeSwapDeltaLibrary.ZERO_DELTA, fee | LPFeeLibrary.OVERRIDE_FEE_FLAG);
}

function _dynamicFee(uint256 _rv) internal pure returns (uint24) {
    // _rv is annualized, 18-dec. Matches sim `spotFeeBps` (src/lib/wolfpit/risk.ts)
    // EXACTLY, including Math.round — then scaled bps -> pips. 0.40 and 5/30 bps are
    // the spec constants (MM.md).
    uint256 spread = _rv > 0.40e18 ? _rv - 0.40e18 : 0;
    uint256 feeBps = (5e18 + 80 * spread + 0.5e18) / 1e18;   // round half up, like Math.round
    if (feeBps < 5) feeBps = 5;
    else if (feeBps > 30) feeBps = 30;
    return uint24(feeBps * 100);                             // bps -> pips: 5 bps = 500
}
```

- `beforeSwap` is `view` — it only reads the accumulator. (v4 invokes hooks with a
  plain `call`, not `staticcall`, so `view` is a self-imposed guarantee — keep it.)
- Clamp to `[5,30]` bps = `[500,3000]` pips. `fee` is `uint24` in **pips**
  (hundredths of a bip; `LPFeeLibrary.MAX_LP_FEE = 1_000_000` = 100%). The returned
  fee MUST carry `OVERRIDE_FEE_FLAG` (`0x400000`); the Pool removes it before use.
- Gate the override on the pool key: only override for `key == poolKey`. Any other
  pool is a no-op returning the existing fee (defense in depth even though a hook
  instance is deployed per pool).
- The existing `spotFeeBps()` in `engine.ts` must produce the **same bps number** as
  `_dynamicFee` for a given RV — the sim is the source of truth for the quant model;
  the hook only scales bps → pips (`×100`).

---

## 6. Depth reporting & the cover-never-concentrated rule

### 6.1 What "depth" means

Depth = the realized **range liquidity in the pool that a swap can actually hit**,
not the nominal TVL. For the vault's purposes:

```
baseDepth  = max over the LPs' active ranges of base-side liquidity in the
             current tick's active price window (ETH term)
quoteDepth = corresponding quote-side liquidity (USDC term)
```

The hook reads this from the PoolManager/`Liquidity` library after the swap (it
already has `delta` and `key`, and knows the post-action price). Because a V4 pool is
concentrated, depth is **price-dependent** — a wide-range LP and a tight-range LP at
the same TVL contribute wildly different depth to the ticks the vault actually trades.
This is the whole reason the hook exists: the vault cannot infer real depth from the
pool's total liquidity or TVL.

### 6.2 The cover-never-concentrated invariant (LP.md §B, Q1-12 AC)

> **Cover = idle vault inventory (full-range or idle), NEVER the concentrated LP
> liquidity of the hook's pool.**

- The `DealerVault`'s `ethBal` (its idle ETH) **is** the only thing that counts as
  cover for written calls / long futures. `reservedEth ≤ α·ethBal`.
- The **hook pool's liquidity does not count as cover**, regardless of depth. A deep
  concentrated LP position on the hook pool cannot back a naked call. This is a hard
  rule; the fork test `add concentrated liq ≠ extra cover` (Q1-12) exists to prove it.
- Concretely: `vault.freeEth()` must be computed from `ethBal − reservedEth` using the
  **vault's own balance**, and the hook reporting `poolDepthQuote=big` must never cause
  the keeper to reduce `reservedEth` or treat the pool as cover. The hook reports depth
  for **hedge sizing and listing oracles**, not for cover.

```solidity
// Guard used by the vault (or keeper) before a risk-increasing order:
function _hedgeable(uint256 sizeEth) internal view returns (bool) {
    // Cover must come from idle vault ETH, not pool depth.
    if (sizeEth > freeEth()) return false;               // NO naked call, ever
    // The hedge swap must fit in reported depth *and* not blow past α.
    uint256 usable = poolDepthBase;                      // reported, not assumed
    if (sizeEth > (usable * DEPTH_SAFE_FRAC) / 1e18) return false;
    return true;
}
```

`DEPTH_SAFE_FRAC` is a conservative fraction (e.g. 0.25, matching `MAX_POOL_FRAC` in
the sim) that keeps the hedge trade inside a fraction of the reported depth so it
cannot move the market against the vault. It is set by Q, not by the implementation.

---

## 7. Invariants & fail-closed rules

These are the **hard laws**. Code review must confirm each; no code path weakens one.

| # | Invariant | Enforced where |
| --- | --- | --- |
| I1 | The hook holds **no** position and keeps **no** delta. `afterAddLiquidity`/`afterRemoveLiquidity` return `0`; `afterSwap` returns `0`. | hook (§3) |
| I2 | The hook has **no** token balances, funds, or allowance; it cannot be `exec`'d or called by the keeper. Owner is zero / immutable; no admin pauser on the hook. | hook |
| I3 | The vault **cannot go naked**: `writeCall/size > freeEth()` reverts, `writePut/ size·strike > freeUsdc()` reverts. These live in the vault, not the hook; hook depth is never a substitute. | `DealerVault` |
| I4 | If the hedge cannot complete **now**, the order does not exist. The keeper → vault `openShort`/`writeCall` path reverts; no `hedgeLater()`. | `DealerVault` + keeper |
| I5 | A stale/unreadable depth report is treated as **zero available depth**, not "deep." | vault/keeper (§4 rules) |
| I6 | `reservedEth ≤ α·ethBal` and `reservedUsdc ≤ α·usdcBal` (α = 0.40). The hook's reported depth never influences α. | `DealerVault` |
| I7 | The hook's `beforeSwap` never returns a fee outside `[500,3000]` pips (`[5,30]` bps), always sets `OVERRIDE_FEE_FLAG`, and never a fee (including rounding) that the sim's `spotFeeBps` would disagree with for the same RV. | hook (§5) |
| I8 | The pool's concentrated liquidity is never counted as vault cover. | §6.2 |
| I9 | `afterSwap` vol accumulator is monotonic-safe: same-block observations collapse; a flash-loop cannot spike/falsify RV/fee. | hook (§5.1) |
| I10 | No unbounded state growth. Accumulator + fixed ring buffer only. | hook (§5.1) |

---

## 8. Reentrancy / security notes

- **The hook is only called by the PoolManager** (`poolManagerOnly`). It makes **zero**
  external calls of its own — no token transfers, no vault calls, ever. **Decision:
  pull-only.** The hook stores its observations (vol accumulator + last observed
  depth) and the vault/keeper **reads** them; the vault is written only by the
  keeper's `reconcileDepth` (`onlyOperator`, reads the hook, writes the vault). This
  moves all reentrancy risk into the vault's existing nonReentrant surface and keeps
  every hook callback path free of any external call that could revert a user swap.
- The hook mutates only **O(1) scalar state** inside its callbacks: the vol
  accumulator and the last observed depth (written in `afterSwap` /
  `afterAddLiquidity` / `afterRemoveLiquidity`). Both are `nonReentrant`-safe (no
  nested calls); keep them O(1).
- Do **not** put a vault write inside the hook's callbacks (`afterSwap`/`afterAdd`) —
  it creates a coupling where a vault bug can brick the pool. The hook must never
  revert the underlying swap/liquidity move. **Every callback path returns a valid
  selector even on an internal error**; if depth/vol computation would revert, it is
  skipped, not thrown. The vault is written only by the keeper's `reconcileDepth`.
- `onlyPoolManager` uses the exact `PoolManager` address passed in the constructor; no
  re-delegation.
- No owner/upgrade on the hook. If the fee model changes, deploy a new hook to a new
  address and re-point the pool (or re-initialize), never upgrade in place.

> **Why no-push / pull-only:** Q1-05 draws the hook as `afterSwap/afterAddLiquidity →
> depth to vault`. The implementation detail of *push vs pull* is where the
> reentrancy and revert-latency footguns live. This spec chooses **pull with keeper
> reconcile** for the vault write, and keeps the hook's own writes limited to the vol
> accumulator. If a reviewer insists on a synchronous push, it must be wrapped so a
> vault revert can never bubble back into the pool action — i.e. the hook's vault
> write called via `try/catch`, swallowing the vault error and returning the normal
> selector. **Do not ship a bare external call that can revert a user swap.**

---

## 9. Gas & bounds

- `beforeSwap` / `afterSwap` / `afterAddLiquidity` / `afterRemoveLiquidity` are each
  O(1) (a handful of SSTOREs for the vol accumulator + last-depth store, plus a
  bounded time-weighted EWMA update). Targets: < 40k gas per callback path on Base.
- Keep the vol ring buffer fixed at 4–8 observations; do not grow with swap count.
- On Sepolia the keeper path must stay under the gas that keeps Friday witching
  "boring" (Q1-29) — the hook adds negligible gas, but the **keeper** (which reads
  depth and settles) is the real budget, and it is measured separately.

---

## 10. Test plan (fork test, Q1-12) — "done when"

All on a **fork** (Base mainnet or Sepolia) `forge test`:

| Test | Asserts |
| --- | --- |
| T1 | `afterSwap`/`afterAddLiquidity` on the ETH/USDC pool update `poolDepthBase/Quote` (pull model: keeper reconcile). |
| T2 | `beforeSwap` returns `fee | OVERRIDE_FEE_FLAG` with the bare fee in `[500,3000]` pips = `[5,30]` bps. `RV=0.40` → 500 (5 bps), `RV=0.60` → 2100 (21 bps), `RV=0.7125` → 3000 (30 bps — the saturation kink: `5+80·0.3125=30`), `RV≥0.7125` → 3000. Assert `fee.isOverride()` and that `fee/100` equals sim `spotFeeBps` for the same RV. |
| T3 | **Naked call fails:** setup a big concentrated LP on the hook pool, then `vault.writeCall(size)` where `size > freeEth()` — **reverts `NakedCall`**. Pool depth does NOT rescue it. ("add concentrated liq ≠ extra cover.") |
| T4 | **Cover never concentrated:** vault's `freeEth()` only reflects its own `ethBal − reservedEth`; raising `poolDepth*` does not change `freeEth()`. |
| T5 | **No `hedgeLater`:** a risk-increasing order that cannot complete the hedge **now** reverts (OrderNotFound / HedgePending / similar), never queues. |
| T6 | **Stale depth = 0:** a depth report older than N blocks (no `reconcileDepth` / hook observation in the window) → keeper treats `usable = 0` and refuses to size. |
| T7 | **Same-block collapse:** two swaps in one block produce one vol update; a flash-loop cannot spike RV past a sane bound. |
| T8 | **Fee bounds invariant:** across a fuzzed RV sweep, `_dynamicFee(rv)` never exits `[500,3000]` pips (`[5,30]` bps), and at rounding boundaries (`RV = 0.405…0.415`) the hook's bps equals sim `spotFeeBps` exactly. |
| T9 | **Hook holds no delta:** after a swap/liquidity move the hook's token balance delta is zero and return deltas are zero. |
| T10 | **PoolManager-only:** a direct call to `afterSwap` from a non-PoolManager reverts. |

**Drill parity:** the sim's `spotFeeBps` and the hook's `_dynamicFee` are the same
function; the five RISK drills (D1–D5) replay against the on-chain vault with keepers
delayed 2 min (Q1-15) — any divergence in the fee/IV that would change the spread or
the Γ/ν caps is a fail.

---

## 11. Explicitly not v1 (do not build)

- The hook does **not** quote, price, or hedge options/futures.
- The hook does **not** hold a position, earn a delta, or collect fees.
- No upgradeability, no admin pauser on the hook.
- No `hedgeLater()` / deferred hedge path anywhere.
- No concentrated LP counted as vault cover.
- Not on **Ethereum L1**. Not a funded vault. Not Hyperliquid.
- No other underlyings in v1; single ETH/USDC pool hook.

---

## 12. Review sign-off (Q)

| Item | Sign-off |
| --- | --- |
| Fee formula `5+80·max(0,RV−0.40)` clamp 5–30 | |
| `DEPTH_SAFE_FRAC` value | |
| Vol EWMA λ=0.94 + IV `1.08·RV` | |
| Pull-vs-push depth model | |
| Hook flags / zero-delta | |

> Implementation (Q1-12) may not deploy to Base mainnet until `docs/DEPLOY-BASE.md`
> checklist (two audits, pause, public addresses, no EOA mint, counsel geo, drills
> pass) is green. Spec only today.
