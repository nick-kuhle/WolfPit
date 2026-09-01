// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DealerVault, IERC20, IOracle} from "../src/DealerVault.sol";
import {ChainlinkOracle} from "../src/oracle/ChainlinkOracle.sol";
import {logAddr, logLine} from "./ConsoleLog.sol";
import {MedianOracle} from "../src/oracle/MedianOracle.sol";

interface Vm {
    function envAddress(string calldata key) external returns (address);
    function envOr(string calldata key, address value) external returns (address);
    function envOr(string calldata key, bool value) external returns (bool);
    function startBroadcast() external;
    function stopBroadcast() external;
    function label(address account, string calldata newName) external;
}

/// @dev forge-std-free bindings.
Vm constant vm = Vm(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);

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
 *   Optional — a SECOND price source, strongly recommended (v1.1 hardening):
 *     BASE_ORACLE_AGG_2 a second Chainlink-shaped ETH/USD aggregator. When set,
 *                       the vault is deployed behind `MedianOracle` instead of a
 *                       single feed, so no ONE source can mark the book: two
 *                       sources must agree inside `maxDevBps` or the oracle
 *                       returns 0 and the vault halts risk.
 *     BASE_ORACLE_SRC_3 an optional third source that ALREADY exposes
 *                       `ethUsdc()` (e.g. a Uni v3 TWAP adapter). With three
 *                       sources the median is taken, so one liar cannot move it.
 *   Defaults (canonical, verify before broadcast):
 *     BASE_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 (native USDC)
 *     BASE_WETH = 0x4200000000000000000000000000000000000006 (canonical WETH)
 *
 *   Oracle ownership is handed to BASE_OWNER before the script exits — the
 *   deploying EOA must not keep `setBand` on a live price feed.
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
        address agg2 = vm.envOr("BASE_ORACLE_AGG_2", address(0));
        address src3 = vm.envOr("BASE_ORACLE_SRC_3", address(0));

        vm.startBroadcast();
        ChainlinkOracle oracle = new ChainlinkOracle(agg);

        // One feed = one point of failure that marks the whole book. When a
        // second source is configured, the vault reads the MEDIAN instead: two
        // sources must agree inside the deviation band or the oracle returns 0
        // and DealerVault halts risk-taking (`spot()` reverts BadOracle).
        IOracle vaultOracle = IOracle(address(oracle));
        ChainlinkOracle oracle2;
        MedianOracle median;
        if (agg2 != address(0)) {
            oracle2 = new ChainlinkOracle(agg2);
            median = new MedianOracle(address(oracle), address(oracle2), src3);
            vaultOracle = IOracle(address(median));
        }

        DealerVault vault = new DealerVault(IERC20(usdc), IERC20(weth), vaultOracle, owner, operator, true);

        // Hand every oracle admin to the multisig. `ChainlinkOracle`/
        // `MedianOracle` set `owner = msg.sender` in their constructors — which
        // under `startBroadcast` is the DEPLOYING EOA — so skipping this would
        // leave a hot key holding `setBand` / `setMaxDevBps` on a live feed.
        // Unconditional: when BASE_OWNER already is the broadcaster this is a
        // no-op transfer to itself, never a silent skip.
        oracle.setOwner(owner);
        if (address(oracle2) != address(0)) oracle2.setOwner(owner);
        if (address(median) != address(0)) median.setOwner(owner);
        vm.stopBroadcast();

        vm.label(address(oracle), "ChainlinkOracle");
        vm.label(address(vault), "DealerVault");
        // Terminal summary — copy into the desk config (VITE_VAULT etc.).
        logAddr("oracle", address(oracle));
        if (address(median) != address(0)) {
            vm.label(address(oracle2), "ChainlinkOracle2");
            vm.label(address(median), "MedianOracle");
            logAddr("oracle2", address(oracle2));
            logAddr("median (vault reads this)", address(median));
            if (src3 != address(0)) logAddr("source3", src3);
        } else {
            logLine(
                "WARNING: single price source. Set BASE_ORACLE_AGG_2 to deploy behind MedianOracle before taking real risk."
            );
        }
        logAddr("vault", address(vault));
        logAddr("usdc", usdc);
        logAddr("weth", weth);
    }
}
