# WolfPit contracts (TEST)

Foundry + **Alloy** keeper. Base Sepolia later. **Not Ethereum L1. Not funded.**

```
forge test --root contracts
cargo test --manifest-path crates/keeper/Cargo.toml
```

## Layout

| Contract | Role |
| --- | --- |
| `DealerVault` | Cover, α=0.40, pause, insurance halt |
| `SimplePair` | x·y=k TEST pools (WPIT-USDC, WPIT-ETH) |
| `Farm` | Gauges 70/20/10, harvest tax 1% |
| `Stake` | First-loss WPIT |
| `WPIT` | TEST token, cap, minter |
| `HOOK.md` | **Uni v4 hook SPEC** (Q1-05) — depth lens + dynamic fee, no deploy |

No ERC-1155 series yet (Q1). The Uniswap v4 hook is **spec'd in [HOOK.md](./HOOK.md)** (Q1-05, no deploy); implementation is Q1-12.

## Deploy (Sepolia, unfunded)

```
cd contracts
forge script script/DeployBase.s.sol --rpc-url $BASE_SEPOLIA_RPC --broadcast
```

`script/DeployBase.s.sol` is the Base deploy script (see [docs/DEPLOY-BASE.md](../docs/DEPLOY-BASE.md)); it refuses non-8453 chains unless `BASE_ALLOW_ANY_CHAIN=1` (Sepolia dry-runs). Until `forge-std` is installed, `test/System.t.sol` is the wiring diagram.

## Alloy keeper

`crates/keeper` — reads vault, encodes `pause` / `writeCall`, dry-runs without RPC.

```
WOLFPIT_RPC=https://sepolia.base.org WOLFPIT_VAULT=0x... cargo run -p wolfpit-keeper
```
