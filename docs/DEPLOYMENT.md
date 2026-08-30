# Deployment

## This preview

`npm run dev`. Paper. localStorage `wolfpit-sim-v12`.

## Vercel

Nitro is already on the `vercel` preset (`vite.config.ts`). Connect [nick-kuhle/WolfPit](https://github.com/nick-kuhle/WolfPit) in the Vercel dashboard, or:

```
npx vercel
```

Env (Production + Preview):

```
VITE_CHAIN=sim
```

Do not set `VITE_CHAIN=base` until the live vault exists. Wrong env must not look like live.

Root directory: repo root. Build: `npm run build`. Install: `npm install`.

## Target chain

**Base.** Testnet: Base Sepolia. Production: Base.  
**Not Ethereum L1.** Hyperliquid is a later hedge adapter, not the home. See [CHAIN.md](./CHAIN.md).

## Testnet (P2)

1. Foundry: mock USDC, WETH, WPIT-TEST
2. Uni v4 ETH/USDC + WPIT pairs (or v2-style while the hook is written)
3. Dealer vault + ERC-1155 + gauges
4. `VITE_CHAIN=base-sepolia` and addresses
5. Keepers: liquidate, expire, inventory band, harvest

## Unfunded TEST on Base mainnet

Allowed only after:

- [ ] Two vault audits
- [ ] Pause listings
- [ ] Public addresses + disclaimer
- [ ] No mint in an EOA
- [ ] Counsel on geo
- [ ] Drills in [RISK.md](./RISK.md) recorded pass

## GitHub

[github.com/nick-kuhle/WolfPit](https://github.com/nick-kuhle/WolfPit) · plans: [WPplans](https://github.com/nick-kuhle/WPplans)
