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
0.5 / 1 % presets + custom). The card also surfaces network, rate, route,
fee % AND fee amount, min received, price impact, and estimated gas cost in
the native token.

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

Until `ZEROX_API_KEY` and `VITE_FEE_RECIPIENT` are set, the swap card shows a
"router not fully configured" notice and quotes return a clear config error —
the rest of the app is unaffected.

## Launch gating

Spot is the only product live at launch. Betting is built and turns on later;
futures and options are deployed but gated (`src/lib/wolfpit/features.ts`) until
a WETH/USDC pit pool has liquidity. See `/info` for the customer-facing status.
