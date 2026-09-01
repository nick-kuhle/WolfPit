// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DealerVault, IERC20} from "../src/DealerVault.sol";
import {TestERC20} from "../src/TestERC20.sol";
import {WPIT} from "../src/WPIT.sol";
import {SimplePair} from "../src/SimplePair.sol";

/**
 * Fund the Base Sepolia desk: mint test tokens to the dev wallet, seed the
 * three pools, and stock the vault's dealing inventory + insurance.
 *
 * Separate from DeploySepolia on purpose — funding is repeatable (top up a
 * drained pool) while deployment is not.
 *
 * Required env: every address printed by DeploySepolia, plus SEPOLIA_OWNER.
 *   SEED_ETH_PRICE   USDC per ETH used for the initial pool ratios (default 4000)
 *   SEED_WPIT_PRICE  USDC per WPIT, 6 dp (default 0.25e6)
 *   SEED_USDC        test USDC minted to the dev wallet (default 5,000,000)
 *   SEED_WETH        test WETH minted (default 2,000)
 *   SEED_WPIT        WPIT minted (default 10,000,000)
 *
 * Run AFTER `wpit.acceptMinter()` from the dev wallet.
 */
interface Vm {
    function envAddress(string calldata) external view returns (address);
    function envOr(string calldata, uint256) external view returns (uint256);
    function startBroadcast() external;
    function stopBroadcast() external;
}

interface Console {
    function log(string calldata) external;
    function log(string calldata, uint256) external;
    function log(string calldata, address) external;
}

contract SeedSepolia {
    Vm constant vm = Vm(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);
    Console constant console = Console(0x000000000000000000636F6e736F6c652e6c6f67);

    /// @dev Storage, not locals: solc runs out of stack slots with a dozen
    ///      addresses and amounts in one frame.
    TestERC20 usdc;
    TestERC20 weth;
    WPIT wpit;
    SimplePair poolEthUsdc;
    SimplePair poolWpitUsdc;
    SimplePair poolWpitEth;
    DealerVault vault;

    uint256 ethSide;
    uint256 usdcSide;
    uint256 wpitForUsdcPool;
    uint256 wpitUsdcNotional;
    uint256 wpitForEthPool;
    uint256 wpitEthNotional;

    uint256 constant VAULT_ETH = 100 ether;
    uint256 constant VAULT_USDC = 400_000e6;
    uint256 constant INSURANCE = 25_000e6;

    function run() external {
        _load();
        address owner = vm.envAddress("SEPOLIA_OWNER");

        vm.startBroadcast();
        _mint(owner);
        _seedPools();
        _fundVault();
        vm.stopBroadcast();

        _print();
    }

    function _load() internal {
        usdc = TestERC20(vm.envAddress("VITE_USDC_SEPOLIA"));
        weth = TestERC20(vm.envAddress("VITE_WETH_SEPOLIA"));
        wpit = WPIT(vm.envAddress("VITE_WPIT_SEPOLIA"));
        poolEthUsdc = SimplePair(vm.envAddress("VITE_POOL_ETH_USDC_SEPOLIA"));
        poolWpitUsdc = SimplePair(vm.envAddress("VITE_POOL_WPIT_USDC_SEPOLIA"));
        poolWpitEth = SimplePair(vm.envAddress("VITE_POOL_WPIT_ETH_SEPOLIA"));
        vault = DealerVault(vm.envAddress("VITE_VAULT_SEPOLIA"));
    }

    function _mint(address owner) internal {
        usdc.mint(owner, vm.envOr("SEED_USDC", uint256(5_000_000e6)));
        weth.mint(owner, vm.envOr("SEED_WETH", uint256(2_000 ether)));
        wpit.mint(owner, vm.envOr("SEED_WPIT", uint256(10_000_000 ether)));
    }

    /// @notice 200 ETH of depth, with the two WPIT pools sized off the same
    ///         notional so all three quotes agree at t=0. A pool seeded at a
    ///         price the others disagree with is just a free arbitrage.
    function _seedPools() internal {
        uint256 ethPrice = vm.envOr("SEED_ETH_PRICE", uint256(4_000e6));
        uint256 wpitPrice = vm.envOr("SEED_WPIT_PRICE", uint256(0.25e6));

        ethSide = 200 ether;
        usdcSide = (ethSide * ethPrice) / 1e18;
        wpitUsdcNotional = 250_000e6;
        wpitForUsdcPool = (wpitUsdcNotional * 1e18) / wpitPrice;
        wpitEthNotional = 25 ether;
        wpitForEthPool = (((wpitEthNotional * ethPrice) / 1e18) * 1e18) / wpitPrice;

        weth.approve(address(poolEthUsdc), ethSide);
        usdc.approve(address(poolEthUsdc), usdcSide);
        poolEthUsdc.add(ethSide, usdcSide);

        wpit.approve(address(poolWpitUsdc), wpitForUsdcPool);
        usdc.approve(address(poolWpitUsdc), wpitUsdcNotional);
        poolWpitUsdc.add(wpitForUsdcPool, wpitUsdcNotional);

        wpit.approve(address(poolWpitEth), wpitForEthPool);
        weth.approve(address(poolWpitEth), wpitEthNotional);
        poolWpitEth.add(wpitForEthPool, wpitEthNotional);
    }

    /// @notice Dealing inventory plus the insurance fund. `creditInsurance`
    ///         PULLS real tokens, so it is approved on top of the deposit and
    ///         stays segregated from the trading balance by construction.
    function _fundVault() internal {
        weth.approve(address(vault), VAULT_ETH);
        usdc.approve(address(vault), VAULT_USDC + INSURANCE);
        vault.deposit(VAULT_ETH, VAULT_USDC);
        vault.creditInsurance(INSURANCE);
    }

    function _print() internal {
        console.log("seeded ETH/USDC   weth:", ethSide);
        console.log("                  usdc:", usdcSide);
        console.log("seeded WPIT/USDC  wpit:", wpitForUsdcPool);
        console.log("seeded WPIT/ETH   wpit:", wpitForEthPool);
        console.log("vault inventory   usdc:", VAULT_USDC);
        console.log("vault insurance   usdc:", INSURANCE);
        console.log("Desk is funded. Switch the app to Testnet and trade.");
    }
}
