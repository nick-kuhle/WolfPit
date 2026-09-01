// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {logAddr, logLine} from "./ConsoleLog.sol";
import {DealerVault, IERC20, IOracle} from "../src/DealerVault.sol";
import {ChainlinkOracle} from "../src/oracle/ChainlinkOracle.sol";
import {TestERC20} from "../src/TestERC20.sol";
import {WPIT} from "../src/WPIT.sol";
import {SimplePair} from "../src/SimplePair.sol";
import {Farm} from "../src/Farm.sol";
import {Stake} from "../src/Stake.sol";

/**
 * Base Sepolia (84532) test launch — token, pools, vault, farm, stake.
 *
 * This is the rehearsal for mainnet: same contracts, same wiring, worthless
 * tokens. It deliberately does NOT reuse DeployBase.s.sol, because the mainnet
 * script must never grow a mint function or a chain-id escape hatch.
 *
 *   Required env:
 *     SEPOLIA_OWNER      dev wallet — owns vault, pools, farm, stake, and the
 *                        WPIT mint key. On mainnet this is a multisig; on a
 *                        testnet a single dev key is the point.
 *   Optional env:
 *     SEPOLIA_OPERATOR   keeper key (defaults to SEPOLIA_OWNER)
 *     SEPOLIA_ORACLE_AGG Chainlink ETH/USD aggregator on Base Sepolia. If
 *                        unset, a ManualOracle is deployed instead so the desk
 *                        works before a feed is wired — see the warning it
 *                        prints. Never available in DeployBase.
 *     WPIT_CAP           WPIT cap in whole tokens (default 100_000_000)
 *     SEPOLIA_ALLOW_ANY_CHAIN=1  bypass the 84532 guard (local anvil only).
 *                        Note this relaxes only the chain check: away from
 *                        Base Sepolia the vault still requires a CONTRACT
 *                        owner, so a full local rehearsal either points
 *                        SEPOLIA_OWNER at a contract or runs anvil with
 *                        --chain-id 84532. The EOA dev-wallet path exists on
 *                        Base Sepolia only.
 *
 * Run:
 *   forge script script/DeploySepolia.s.sol \
 *     --rpc-url $SEPOLIA_RPC_URL --broadcast --verify
 *
 * It prints a paste-ready VITE_* block; the seed step lives in
 * SeedSepolia.s.sol so funding is a separate, repeatable transaction.
 */
interface Vm {
    function envAddress(string calldata) external view returns (address);
    function envOr(string calldata, address) external view returns (address);
    function envOr(string calldata, bool) external view returns (bool);
    function envOr(string calldata, uint256) external view returns (uint256);
    function startBroadcast() external;
    function stopBroadcast() external;
    function label(address, string calldata) external;
}

/**
 * @notice Owner-settable price source for a testnet with no Chainlink feed.
 *         Testnet only: it is deployed solely by this script, and the vault
 *         treats it like any other IOracle.
 */
contract ManualOracle {
    address public owner;
    uint256 public price; // USDC per ETH, 6 dp

    error NotOwner();
    error Zero();

    event PriceSet(uint256 price);
    event OwnerSet(address indexed previous, address indexed next);

    constructor(uint256 initial) {
        if (initial == 0) revert Zero();
        owner = msg.sender;
        price = initial;
        emit PriceSet(initial);
    }

    function setOwner(address next) external {
        if (msg.sender != owner) revert NotOwner();
        if (next == address(0)) revert Zero();
        emit OwnerSet(owner, next);
        owner = next;
    }

    function setPrice(uint256 p) external {
        if (msg.sender != owner) revert NotOwner();
        if (p == 0) revert Zero();
        price = p;
        emit PriceSet(p);
    }

    function ethUsdc() external view returns (uint256) {
        return price;
    }
}

contract DeploySepolia {
    Vm constant vm = Vm(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);

    uint256 constant BASE_SEPOLIA = 84532;
    uint256 constant DEFAULT_CAP = 100_000_000 ether;
    uint256 constant SEED_PRICE = 4_000e6; // only used by the manual oracle

    /// @dev Held in storage rather than locals: `run()` touches eleven
    ///      addresses and solc runs out of stack slots otherwise.
    struct Deployment {
        address usdc;
        address weth;
        address wpit;
        address oracle;
        address vault;
        address poolEthUsdc;
        address poolWpitUsdc;
        address poolWpitEth;
        address farm;
        address stake;
        bool manualOracle;
    }

    Deployment public d;

    function run() external {
        if (block.chainid != BASE_SEPOLIA) {
            require(vm.envOr("SEPOLIA_ALLOW_ANY_CHAIN", false), "wrong chain: expected Base Sepolia 84532");
        }
        address owner = vm.envAddress("SEPOLIA_OWNER");

        vm.startBroadcast();
        _deploy(owner, vm.envOr("SEPOLIA_OPERATOR", owner), vm.envOr("SEPOLIA_ORACLE_AGG", address(0)));
        _handover(owner);
        vm.stopBroadcast();

        _print();
    }

    function _deploy(address owner, address operator, address agg) internal {
        // Test money. Decimals mirror mainnet exactly (USDC 6, WETH 18) or the
        // pools would price differently here than in production.
        d.usdc = address(new TestERC20("USD Coin (test)", "tUSDC", 6));
        d.weth = address(new TestERC20("Wrapped Ether (test)", "tWETH", 18));
        d.wpit = address(new WPIT(vm.envOr("WPIT_CAP", DEFAULT_CAP)));

        d.manualOracle = agg == address(0);
        d.oracle = d.manualOracle ? address(new ManualOracle(SEED_PRICE)) : address(new ChainlinkOracle(agg));

        // Contract-owner enforcement follows the CHAIN, not the operator's
        // intent (audit N-1): on Base Sepolia the owner is a dev EOA by design
        // — "on a testnet a single dev key is the point" — so hardcoding
        // `true` here just bricked the documented launch with
        // OwnerNotContract() at the vault step (reproduced by dry-run).
        // Everywhere else the strict requirement stands: if this script is
        // ever pointed at another chain via SEPOLIA_ALLOW_ANY_CHAIN, an EOA
        // owner still reverts. Mainnet goes through DeployBase, which always
        // passes true, exactly as `Deployer`'s local shape opts out.
        d.vault = address(
            new DealerVault(
                IERC20(d.usdc), IERC20(d.weth), IOracle(d.oracle), owner, operator, block.chainid != BASE_SEPOLIA
            )
        );

        // token0/token1 order matches the UI pool naming; 30 bps is the pair's
        // default and the top of its allowed band.
        d.poolEthUsdc = address(new SimplePair(IERC20(d.weth), IERC20(d.usdc), 30));
        d.poolWpitUsdc = address(new SimplePair(IERC20(d.wpit), IERC20(d.usdc), 30));
        d.poolWpitEth = address(new SimplePair(IERC20(d.wpit), IERC20(d.weth), 30));

        d.farm = address(new Farm(WPIT(d.wpit), DealerVault(d.vault)));
        d.stake = address(new Stake(WPIT(d.wpit), DealerVault(d.vault)));
    }

    /// @notice Move every privileged role off the deploying key.
    ///
    ///         Each contract sets `owner = msg.sender` in its constructor,
    ///         which during a broadcast is the deploy key. Leaving it there is
    ///         how a "temporary" key ends up holding the mint switch forever.
    function _handover(address owner) internal {
        TestERC20(d.usdc).setOwner(owner);
        TestERC20(d.weth).setOwner(owner);
        SimplePair(d.poolEthUsdc).setOwner(owner);
        SimplePair(d.poolWpitUsdc).setOwner(owner);
        SimplePair(d.poolWpitEth).setOwner(owner);
        Farm(d.farm).setOwner(owner);
        Stake(d.stake).setOwner(owner);
        if (d.manualOracle) ManualOracle(d.oracle).setOwner(owner);
        else ChainlinkOracle(d.oracle).setOwner(owner);

        // WPIT's mint key moves by two-step handshake: the deployer proposes
        // and the dev wallet accepts. Deliberately NOT auto-accepted - a typo
        // must be visible between two transactions.
        WPIT(d.wpit).setMinter(owner);
    }

    function _print() internal {
        logLine("");
        logLine("=== Base Sepolia deployment - paste into Vercel (Preview + Production) ===");
        logLine("VITE_CHAIN=base-sepolia");
        logAddr("VITE_VAULT_SEPOLIA", d.vault);
        logAddr("VITE_WPIT_SEPOLIA", d.wpit);
        logAddr("VITE_USDC_SEPOLIA", d.usdc);
        logAddr("VITE_WETH_SEPOLIA", d.weth);
        logAddr("VITE_POOL_ETH_USDC_SEPOLIA", d.poolEthUsdc);
        logAddr("VITE_POOL_WPIT_USDC_SEPOLIA", d.poolWpitUsdc);
        logAddr("VITE_POOL_WPIT_ETH_SEPOLIA", d.poolWpitEth);
        logAddr("VITE_FARM_SEPOLIA", d.farm);
        logAddr("VITE_STAKE_SEPOLIA", d.stake);
        logAddr("ORACLE", d.oracle);
        logLine("");
        logLine("NEXT: from the dev wallet call wpit.acceptMinter() to finish the mint handover,");
        logLine("then run SeedSepolia.s.sol to mint test tokens and fund the pools.");
        if (d.manualOracle) {
            logLine(
                "WARNING: no SEPOLIA_ORACLE_AGG given, so a ManualOracle was deployed. Price is owner-set and "
                "does NOT track the market. Set a Chainlink aggregator before judging any risk behaviour."
            );
        }
    }
}
