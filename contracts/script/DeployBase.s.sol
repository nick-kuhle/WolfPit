// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DealerVault, IERC20, IOracle} from "../src/DealerVault.sol";
import {ChainlinkOracle} from "../src/oracle/ChainlinkOracle.sol";

interface Vm {
    function envAddress(string calldata key) external returns (address);
    function envOr(string calldata key, address value) external returns (address);
    function envOr(string calldata key, bool value) external returns (bool);
    function startBroadcast() external;
    function stopBroadcast() external;
    function label(address account, string calldata newName) external;
}

interface Console {
    function log(string calldata label, address value) external;
}

/// @dev forge-std-free bindings.
Vm constant vm = Vm(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);
Console constant console = Console(0x000000000000000000636F6e736F6c652e6c6f67);

/**
 * @notice Base mainnet launch deploy (runbook: docs/DEPLOY-BASE.md).
 *
 *   Launch shape — NO WPIT token, NO house liquidity pool:
 *     ChainlinkOracle(ETH/USD agg)  +  DealerVault(native USDC, WETH, oracle)
 *
 *   Required env (fail-closed — no silent defaults for anything trust-bearing):
 *     BASE_ORACLE_AGG   Chainlink ETH/USD aggregator on Base (data.chain.link → Base)
 *     BASE_OWNER        multisig that will own the vault
 *     BASE_OPERATOR     keeper hot key (risk accounting + exec swaps)
 *   Defaults (canonical, verify before broadcast):
 *     BASE_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 (native USDC)
 *     BASE_WETH = 0x4200000000000000000000000000000000000006 (canonical WETH)
 *
 *   forge script contracts/script/DeployBase.s.sol --rpc-url $BASE_RPC_URL \
 *     --broadcast --verify --etherscan-api-key $ETHERSCAN_API_KEY
 */
contract DeployBase {
    // Canonical Base mainnet tokens. Verify: developers.circle.com + basescan.
    address constant NATIVE_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant CANONICAL_WETH = 0x4200000000000000000000000000000000000006;

    function run() external {
        // Hard guard: this script deploys the MAINNET launch shape with
        // canonical USDC/WETH. Refuse to run on anything but Base mainnet
        // unless BASE_ALLOW_ANY_CHAIN=1 is set deliberately (e.g. Sepolia
        // dry-runs of the same deploy).
        if (!vm.envOr("BASE_ALLOW_ANY_CHAIN", false) && block.chainid != 8453) {
            revert("WolfPit: DeployBase targets Base mainnet (8453). Set BASE_ALLOW_ANY_CHAIN=1 to override.");
        }
        address agg = vm.envAddress("BASE_ORACLE_AGG");
        address owner = vm.envAddress("BASE_OWNER");
        address operator = vm.envAddress("BASE_OPERATOR");
        address usdc = vm.envOr("BASE_USDC", NATIVE_USDC);
        address weth = vm.envOr("BASE_WETH", CANONICAL_WETH);

        vm.startBroadcast();
        ChainlinkOracle oracle = new ChainlinkOracle(agg);
        DealerVault vault =
            new DealerVault(IERC20(usdc), IERC20(weth), IOracle(address(oracle)), owner, operator);
        vm.stopBroadcast();

        vm.label(address(oracle), "ChainlinkOracle");
        vm.label(address(vault), "DealerVault");
        // Terminal summary — copy into the desk config (VITE_VAULT etc.).
        console.log("oracle", address(oracle));
        console.log("vault", address(vault));
        console.log("usdc", usdc);
        console.log("weth", weth);
    }
}
