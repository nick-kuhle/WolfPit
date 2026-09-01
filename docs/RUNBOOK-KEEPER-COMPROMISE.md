# Runbook — keeper (operator) key compromise

> Audit B4. The vault is an accounting primitive with **no on-chain position
> registry**: the keeper's off-chain book is the only record of what the
> reservations cover. That makes the operator hot key the **#1 compromise
> scenario** in the threat model — a hostile operator can release cover out
> from under written options (`releaseCall`/`releasePut`), and the naked
> checks (`reserved > balance`) will never fire because *understating*
> reservations looks healthy on-chain.
>
> Specs win arguments: everything below is enforced by code and tests
> (`DealerVault.t.sol` timelock tests, keeper `reserved_under_floor` tests),
> not by promises.

## Roles recap

| Key | Held by | Powers that matter here |
| --- | --- | --- |
| **owner** | multisig | `setOperator`, `pause` (both directions), `setReleaseDelay`, `vetoRelease`, `convertWpitInsurance`, allowlists, instant `revokeTarget`/`revokeSelector`/`revokeAllowance` |
| **operator** | keeper hot key | `writeCall/Put`, `openShort/Long`, `releaseCall/Put`, `queueRelease*`, `exec`, `pause(true)` only |

The operator can **pause** (fail-closed watcher needs it) but can never
**resume**, un-allowlist itself, move allowances, or touch insurance ledgers
(audit C-3: `pause(false)` is owner-only, so a compromised key cannot undo
the halt behind the watcher's back). Since WP-05 / #12, the OWNER's own
drain surface is constrained too: router and selector allowlist changes and
allowance grants sit behind a 2-day `ADMIN_TIMELOCK`, and allowances are
capped per token — so a compromised operator cannot be handed a new drain
path quickly even by a rushed owner. The asymmetry is deliberate (audit
C-2): grants are slow, but `revokeTarget`, `revokeSelector` and
`revokeAllowance` are **instant** owner calls, so incident response has a
same-block kill switch for a malicious router — including revoking the
allowance it would pull through directly, without `exec`.

## Defenses (armed in this order)

1. **Release timelock** — owner calls `setReleaseDelay(delay)` (≤ 1 day;
   suggested: 300 s once the watcher is live). From then on the operator must
   `queueReleaseCall/Put(amt)` and wait out the eta before `release*`
   succeeds. Re-queueing **replaces** the pending entry and restarts the
   clock — a compromised key cannot stack a big release behind a small one.
   The **owner bypasses the queue** and can `vetoRelease()` at any time.
   Launch default is `0` (immediate) so the keeper's single-tx flow is
   unchanged until the owner arms it. (Distinct from `ADMIN_TIMELOCK`: that
   gates the owner's allowlist surface; this gates the operator's releases.)

   **`setReleaseDelay` clears whatever is pending** (emitting `ReleaseVetoed`),
   because arming a control must bind the situation you are arming it *in*.
   While the delay is 0 a queued entry carries `eta = block.timestamp`; without
   the clear, a hostile operator who pre-queued the whole book would still be
   able to consume it in the same block the owner armed the timelock, and
   *raising* a delay would leave the shorter clock running. After arming (or
   re-arming), the operator simply re-queues under the new delay. Practical
   consequence for the desk: **arm the delay first, then queue** — a legitimate
   release in flight when the owner changes the delay is dropped and must be
   re-queued. Regression tests:
   `testArmingTheDelayClearsAPreQueuedRelease`,
   `testRaisingTheDelayRebindsAPendingRelease`,
   `testDisarmingClearsAndRestoresImmediateReleases`.
2. **Monitor reconciliation floors** — the watcher knows what *should* be
   reserved. Run it with floors from the off-chain book:

   ```sh
   wolfpit-keeper monitor --min-reserved-eth 40 --min-reserved-usdc 160000
   ```

   If on-chain `reservedEth`/`reservedUsdc` ever drops **below** a floor, the
   monitor pauses the vault on-chain (same fail-closed path as the halt
   check). Floors, not exact matches: a growing book is legitimate trading.
   Refresh the floors whenever the book legitimately shrinks (expiries).
3. **Event alerting** — index `RiskReleased`, `ReleaseQueued`,
   `ReleaseVetoed`, `PausedSet`, plus the WP-05 admin events (`AdminQueued`,
   `SelectorAllowed`, `AllowanceCapSet`). Any `ReleaseQueued` or
   `AdminQueued` the desk didn't originate is a page, not a log line.

## Compromise response (owner multisig, in order)

1. `pause(true)` — stops all new risk and all releases (`live` gate). LP
   withdrawals stay available; nothing strands.
2. `vetoRelease()` — clears anything sitting in the release queue.
3. `setOperator(newKey)` — rotate to a fresh key from a clean machine. The
   old key is dead the moment this lands. If a router looks involved, kill it
   the same block: `revokeAllowance(token, router)` for every grant,
   `revokeTarget(router)` — no timelock on the kill direction (C-2).
4. Reconcile: compare the off-chain book against on-chain `reservedEth`/
   `reservedUsdc`. If cover was released behind the book, re-reserve via
   `writeCall`/`writePut` (as the new operator) **before** resuming, so every
   outstanding option is collateralized again. `reconcileBalances()` checks
   the token side — and now refuses to sync the book past the α law (C-1):
   if it reverts `UtilCap`, unwind reserves first, never the other way round.
5. `pause(false)` only after (4) balances to zero drift. The owner signs it —
   the compromised key cannot (C-3).

Total on-chain cost of the response is three multisig txs; nothing in it
requires the compromised key's cooperation.

## Standing hygiene

- Keeper key is `WOLFPIT_KEEPER_KEY` (env, never a CLI flag — WP-14 / #19;
  prefer `--key-file` with a 0600 file, or a KMS/hardware signer), funded
  for gas only — it holds no inventory and no allowances of its own.
- The key never leaves the keeper host; deploys and admin go through the
  multisig (`DeployBase.s.sol` runbook).
- Drill this runbook like D1–D5: fire `queueReleaseCall` from a "hostile"
  key on Sepolia, verify the veto + rotate path end to end.
