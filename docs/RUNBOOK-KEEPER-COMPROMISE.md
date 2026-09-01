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
| **owner** | multisig | `setOperator`, `pause`, `setReleaseDelay`, `vetoRelease`, `convertWpitInsurance`, allowlists |
| **operator** | keeper hot key | `writeCall/Put`, `openShort/Long`, `releaseCall/Put`, `queueRelease*`, `exec`, `pause` |

The operator can **pause** (fail-closed watcher needs it) but can never
un-allowlist itself, move allowances, or touch insurance ledgers. Since
WP-05 / #12, the OWNER's own drain surface is constrained too: router and
selector allowlist changes and allowance grants sit behind a 2-day
`ADMIN_TIMELOCK`, and allowances are capped per token — so a compromised
operator cannot be handed a new drain path quickly even by a rushed owner.

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
   old key is dead the moment this lands.
4. Reconcile: compare the off-chain book against on-chain `reservedEth`/
   `reservedUsdc`. If cover was released behind the book, re-reserve via
   `writeCall`/`writePut` (as the new operator) **before** resuming, so every
   outstanding option is collateralized again. `reconcileBalances()` checks
   the token side.
5. `pause(false)` only after (4) balances to zero drift.

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
