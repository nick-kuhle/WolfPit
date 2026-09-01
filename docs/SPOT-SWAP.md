# Spot swap — real on-chain trading (Base)

Launch spot is **real, non-custodial market-order trading on Base**, routed
through a DEX aggregator for best execution. It is a separate surface from the
paper desk (`/trade`), which remains the simulation engine. Real money never
touches the sim.

## Surfaces

| Path              | What it is                                                        |
|-------------------|-------------------------------------------------------------------|
| `/trade`          | ONE trade page with a **Simulation / Live** toggle (top bar)      |
| `/trade?mode=live`| Live desk — real on-chain market swaps, any supported chain       |
| `/swap`           | Redirects to `/trade?mode=live` (legacy links keep working)       |
| `/info`           | Public fees + protocol info page (linked from the **More** tab)   |

**Chains.** The live desk opens on **Base (★ default)** and covers every chain
the aggregator serves: Ethereum, Arbitrum, Optimism, Polygon, BNB, Avalanche,
Gnosis, Celo, Mantle, Blast, Linea, Scroll, ZKsync, Unichain, Berachain
(`src/lib/swap/chains.ts`). Selecting a chain re-quotes on it, shows the
wallet's current network vs. selection, and prompts switch/add in the wallet
when you submit.

**Tokens.** Any tradeable token: the token picker always offers the
chain-native asset, searches by symbol/name, and resolves pasted contract
addresses via direct on-chain ERC-20 reads. Symbol/name search cascades
server-side: 0x Tokens API index (when `ZEROX_API_KEY` is set) → DexScreener
pair search (keyless; matches base OR quote side of each pair, ranked by
liquidity, decimals read on-chain) → CoinGecko platform addresses (keyless,
merged in when results are thin). Headline Base tokens (WETH · USDC) are
curated offline so they are always findable regardless of upstream rate
limits. Results are cached 5 min per (chain, query).

**User knobs.** Slippage tolerance is user-settable in the card (0.1 / 0.3 /
0.5 / 1 % presets + custom, clamped to 0.01–5.00% in the UI AND on the server
— the tolerance shown is the tolerance executed). The card also surfaces
network, rate, route, fee % AND fee amount (or "None on this chain" where the
fee is not collected), min received, price impact (percent), and estimated gas
cost in the native token.

**Verified tokens.** Tokens from the 0x index / curated list are marked
"verified"; community hits from the keyless fallbacks (DexScreener, CoinGecko)
are marked "unverified" in the picker, and the swap card warns when either leg
is unverified, plus a warning when the route reports a transfer/sell tax.

**Chart.** The live desk charts the leg you are taking a view on, in USD — the
same series the simulation desk draws for that token. `src/lib/swap/chart-feed.ts`
ranks the pair (long-tail token > major > stablecoin, ties to the sell leg) and
resolves that token's **contract** to its deepest pool: chainId → GeckoTerminal
network slug → `/tokens/{addr}/pools` → DexScreener fallback, memoized 10 min.
Only pools where the token is the pool's **base** token are eligible, because
GeckoTerminal OHLCV reports the base token's price — charting the quote side
would draw the other token's price. Candles refresh every 60 s.

The executable pair rate from the aggregator is shown on its own labelled line
under the header, never as the chart's headline: the chart is denominated in USD
and the rate is not. If no real series exists for the token, the chart draws an
indicative series anchored at the best real price available (resolver spot, else
the quote-implied USD) and badges it `sim · indicative` — it never anchors at
1.00 and never badges while a real series is still loading.

The toggle is the only way real funds are reached: the default is Simulation
(paper, $100k), `?mode=live` or the persisted localStorage choice switches to
the live desk. The dock's **Trade** tab highlights for both modes.

## How it works

1. The user enters a market order (amount in → token out) on `/swap`.
2. The client calls the `spotQuote` server function
   (`src/lib/swap/actions.ts`), which proxies the **0x Swap API v2**
   (`src/lib/swap/quote.server.ts`) — server-side so the API key never reaches
   the browser.
3. 0x returns the best route across Base liquidity (Uniswap, Aerodrome, RFQ,
   etc.) plus the executable transaction. The **WolfPit trading fee** is
   attached as the 0x affiliate fee (`swapFeeRecipient` + `swapFeeBps`), so it
   is collected **on-chain in the same transaction** and paid directly to the
   WolfPit wallet.
4. **Multi-chain.** `chainId` rides the quote request (validated against the
   catalog server-side). The WPIT discount only ever applies on Base, where
   WPIT exists.
5. **WPIT discount is verified server-side.** For firm quotes (taker present)
   the server reads `balanceOf(WPIT, taker)` on-chain and prices the fee from
   that; the client's `holdsWpit` flag is a display hint only. RPC failure is
   conservative: full fee. (Zero RPC calls while `VITE_WPIT` is unset.)
6. `useSwap` (`src/lib/swap/use-swap.ts`) drives the flow: debounced indicative
   pricing while typing → firm quote on submit → ensure the wallet is on Base →
   ERC-20 approval if needed (native ETH needs none) → send swap → wait for the
   receipt.
5. On-chain reads (balances, allowance, WPIT holding) go through viem
   (`src/lib/swap/chain.ts`) against a public Base RPC. Writes go through the
   injected wallet already managed by `src/lib/wallet/session.ts`.

## Fees

- Default **0.50%** (50 bps), shown transparently in the quote before signing.
- **50% discount** (→ 0.25%) for any wallet **holding WPIT**. The discount is
  verified at quote time and is **dormant until WPIT lists** — until then every
  wallet pays the full fee. It activates automatically once `VITE_WPIT` points
  at a live token; no code change required.
- **Fee collection is chain-gated** (`VITE_FEE_CHAINS`, default Base only): the
  fee is paid on-chain to the fee wallet on the swap's chain, and an address
  that exists on Base may have no owner elsewhere (e.g. a Base-only Safe).
  Extend the list only after verifying the recipient on each chain; on chains
  outside it no integrator fee is charged and the UI says "None on this chain".
- The trading fee is separate from Base network gas and from the DEX LP fee
  already baked into the quoted price.

All fee/behaviour knobs live in `src/lib/swap/config.ts`.

## Configuration (see `env.example`)

| Variable                 | Scope        | Purpose                                        |
|--------------------------|--------------|------------------------------------------------|
| `ZEROX_API_KEY`          | server-only  | 0x Swap API key. **Never** prefix `VITE_`.     |
| `VITE_FEE_RECIPIENT`     | public       | WolfPit wallet that receives the on-chain fee. |
| `VITE_WPIT`              | public       | WPIT token address. Enables the fee discount.  |
| `VITE_SWAP_FEE_BPS`      | public       | Trading fee in bps (default 50).               |
| `VITE_SWAP_FEE_DISCOUNT` | public       | Discount fraction (default 0.5 = 50% off).     |
| `VITE_SWAP_SLIPPAGE_BPS` | public       | Default slippage tolerance (default 50).       |
| `VITE_BASE_RPC_URL`      | public       | Optional dedicated Base RPC for reads.         |
| `VITE_FEE_CHAINS`        | public       | Chains the fee is collected on (default 8453). |

Until `ZEROX_API_KEY` and a valid `VITE_FEE_RECIPIENT` are set, the swap card
shows a "router not fully configured" notice and quotes return a clear config
error — the rest of the app is unaffected.

## Safety checks on every executable quote

Before a swap tx is sent, the client verifies (see `src/lib/swap/chain.ts`):

- the approval spender is 0x **Permit2** or **AllowanceHolder** — the only
  contracts 0x permits for allowances (never the Settler);
- `transaction.to` is a **deployed contract** (never an EOA / missing address);
- for Permit2 quotes, the spender inside the signed permit **equals** `tx.to`;
- native sells carry **exactly** the sell amount; token sells carry 0 value;
- the calldata is non-empty.

Any violation blocks the swap with a user-facing "Safety check" message.

## Launch gating

Spot is the only product live at launch. Betting is built and turns on later;
futures and options are deployed but gated (`src/lib/wolfpit/features.ts`) until
a WETH/USDC pit pool has liquidity. See `/info` for the customer-facing status.
