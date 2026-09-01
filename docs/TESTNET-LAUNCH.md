# Base Sepolia test launch

How to put the desk on a real chain with worthless tokens, and what each step
is protecting against. Mainnet is a separate document (`DEPLOY-BASE.md`) and a
separate script on purpose: the testnet script mints money, and that ability
must never be one environment variable away from production.

Home chain is **Base**. The testnet is Base Sepolia (84532), never L1, never
another L2.

---

## 0. What ships in these phases

| Phase | What it does |
| --- | --- |
| 0 | Every desk asks the **server** whether it may accept an order. |
| 1 | One app-wide `Sim / Testnet / Live` selector. |
| 2 | `DeploySepolia.s.sol` + `SeedSepolia.s.sol`. |
| 3 | Dev-wallet controls in `/admin`, signed in the browser, testnet only. |

### Phase 0 — the gate now covers all four desks

`checkTradingAllowed` had exactly one caller: `spotQuote`. Futures, options and
the race were gated by `gated()` in `src/lib/wolfpit/store.ts`, which reads
`useAdmin` — client state, persisted to `localStorage`, editable by anyone with
devtools. Pausing the book stopped spot and nothing else, while the admin panel
implied it had stopped everything.

Order entry is now async and every desk calls `deskOpen({product})`
(`src/lib/wolfpit/desk-gate.ts`) before an order is applied. Rules:

- **Unreachable server means refused.** The same rule the hedge follows: an
  order the desk cannot confirm is an order that does not exist.
- **An unknown product is gated as the strictest one**, so a typo in a caller
  cannot become an ungated desk.
- The local `gated()` check stays as a fast mirror for instant feedback. It is
  not the decision.

These desks are still paper. The gate is in front of them now so that it does
not have to be retrofitted at the moment real money arrives.

### Phase 1 — one mode selector, everywhere

The old switch lived inside `/trade` as local state with its own storage key;
no other route knew which mode you were in. `ModeProvider`
(`src/lib/wolfpit/mode.tsx`) owns it once, `ModeToggle` sits in the app shell,
and `ModeBanner` states what is at stake on every page.

- A mode whose vault address is not configured **is not offered**. A tab that
  cannot work is worse than no tab.
- A stored mode that is no longer available is ignored on load, so retiring the
  testnet does not strand users in it.
- Server and client both start at `sim`, then the effect upgrades from the URL
  or `localStorage`, so hydration cannot mismatch.

**Removing the testnet later is one line:** delete `"testnet"` from `MODES` in
`src/lib/wolfpit/mode-config.ts`. The union type narrows and every remaining
reference fails to compile.

---

## 1. Deploy

```bash
export SEPOLIA_RPC_URL=https://sepolia.base.org
export SEPOLIA_OWNER=0xYourDevWallet          # ends up owning everything
export SEPOLIA_OPERATOR=0xYourKeeper          # optional, defaults to OWNER
export SEPOLIA_ORACLE_AGG=0xChainlinkEthUsd   # optional, see below

forge script script/DeploySepolia.s.sol \
  --root contracts --rpc-url "$SEPOLIA_RPC_URL" --broadcast --verify
```

Deploys tUSDC (6 dp), tWETH (18 dp), WPIT, an oracle, the DealerVault, three
SimplePair pools, Farm and Stake — then **hands every role to
`SEPOLIA_OWNER`**. Each contract sets `owner = msg.sender` in its constructor,
which during a broadcast is the deploy key; leaving it there is how a
"temporary" key ends up holding the mint switch forever. (`SimplePair` had no
transfer at all until this phase — `setOwner` was added, with tests.)

Decimals mirror mainnet exactly. A test USDC with 18 decimals would price every
pool differently here than in production and the rehearsal would be worthless.

**No `SEPOLIA_ORACLE_AGG`?** The script deploys a `ManualOracle` whose price is
owner-set, prints a warning, and the app exposes a "set price" control. Useful
for forcing a liquidation. It does **not** track the market — do not judge any
risk behaviour against it.

**Then, from the dev wallet:** call `wpit.acceptMinter()`. The mint key moves by
two-step handshake and the script deliberately does not auto-accept it, so a
typo'd address is visible between two transactions instead of permanent.

## 2. Seed

```bash
# paste the VITE_*_SEPOLIA values the deploy printed, then:
forge script script/SeedSepolia.s.sol \
  --root contracts --rpc-url "$SEPOLIA_RPC_URL" --broadcast
```

Mints test tokens to the dev wallet, seeds 200 ETH of depth in ETH/USDC and
sizes both WPIT pools off the same notional so all three quotes agree at t=0 (a
pool seeded at a price the others disagree with is just free arbitrage), then
funds the vault with 100 ETH / 400k USDC of inventory plus a 25k insurance
credit. `creditInsurance` pulls real tokens and is approved on top of the
deposit; it stays segregated from the trading balance by construction.

Re-runnable: run it again to top up a drained pool.

## 3. Point the app at it

Paste the printed `VITE_*_SEPOLIA` block into Vercel (Preview **and**
Production) and redeploy. The `Testnet` tab appears once `VITE_VAULT_SEPOLIA`
is a real address.

## 4. Dev controls (`/admin`)

Mint tokens, set the oracle price, top up a pool.

**The server never holds a key.** Every control builds calldata
(`src/lib/admin/dev-controls.ts`) and the operator's own wallet signs it. If
this app is compromised, the attacker gets a form, not a mint. `docs/DEV.md`
requires this and Phase 3 keeps it.

**These controls do not exist on mainnet.** Not disabled — absent. The panel
returns `null` and every builder refuses chain 8453 by name. A greyed-out mint
button is one bad conditional away from a live one, so there is no button.

Also enforced, with tests in `dev-controls.test.ts`:

- amounts are parsed against the token's real decimals and a safety cap, so a
  fat-fingered `1e30` never becomes calldata;
- approvals are **bounded to the exact amount**, never `type(uint256).max`
  (the discipline WP-05 / #12 imposed on the vault);
- pool adds carry a real 15-minute deadline, never `type(uint256).max`;
- an unconfigured or malformed address is refused rather than encoded;
- every call is labelled, so the operator reads what they are about to sign.

---

## Checklist before calling the testnet "live"

- [ ] `wpit.acceptMinter()` done — `wpit.minter()` is the dev wallet.
- [ ] `pair.owner()`, `farm.owner()`, `stake.owner()`, oracle owner: all the dev
      wallet, none the deploy key.
- [ ] Vault owner is the dev wallet; on mainnet this must be a multisig (#12).
- [ ] All three pools quote consistently — no free arbitrage at t=0.
- [ ] Pause from `/admin`, then confirm **all four** desks refuse (Phase 0). The
      spot-only pause is the exact bug this phase closed.
- [ ] `VITE_ORACLE_SEPOLIA` set only if the ManualOracle was deployed.
- [ ] `WOLFPIT_TRADING_PAUSED` unset in the environment (env ∪ DB restrictions:
      a stale `1` cannot be un-paused from the UI).
