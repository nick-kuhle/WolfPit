// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DealerVault, IERC20} from "../src/DealerVault.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {SimplePair} from "../src/SimplePair.sol";
import {TestERC20} from "../src/TestERC20.sol";
import {WPIT} from "../src/WPIT.sol";
import {DeploySepolia} from "../script/DeploySepolia.s.sol";

interface Vm {
    function prank(address) external;
    function setEnv(string calldata, string calldata) external;
    function chainId(uint256) external;
}

/// @notice Testnet-launch prerequisites.
///
///         The Sepolia deploy hands every contract to the dev wallet. That is
///         only possible if each contract can actually be handed over, and
///         SimplePair could not: it set `owner = msg.sender` in its
///         constructor and offered no transfer, so the fee switch would stay
///         with the deploying key permanently. These tests hold that door open.
contract TestnetLaunchTest {
    Vm constant vm = Vm(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);

    MockERC20 usdc;
    MockERC20 weth;
    SimplePair pair;
    address constant DEV = address(0xDEF1);

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        weth = new MockERC20("Wrapped Ether", "WETH", 18);
        pair = new SimplePair(IERC20(address(weth)), IERC20(address(usdc)), 30);
    }

    function testPoolOwnershipCanLeaveTheDeployKey() public {
        require(pair.owner() == address(this), "deployer owns it at first");
        pair.setOwner(DEV);
        require(pair.owner() == DEV, "handed over");

        // The old key must lose the fee switch, not merely share it.
        try pair.setFeeBps(5) {
            revert("previous owner still controls the fee");
        } catch {}

        vm.prank(DEV);
        pair.setFeeBps(5);
        require(pair.feeBps() == 5, "new owner controls the fee");
    }

    function testPoolOwnershipCannotBeBurned() public {
        try pair.setOwner(address(0)) {
            revert("zero owner accepted - fee switch would be frozen forever");
        } catch {}
        require(pair.owner() == address(this), "unchanged");
    }

    function testNonOwnerCannotSeizeThePool() public {
        vm.prank(address(0xBAD));
        try pair.setOwner(address(0xBAD)) {
            revert("anyone could take the pool");
        } catch {}
        require(pair.owner() == address(this), "unchanged");
    }

    /// @notice The fee band is still enforced after a handover: a new owner
    ///         inherits the same limits, not a blank cheque.
    function testFeeBandSurvivesHandover() public {
        pair.setOwner(DEV);
        vm.prank(DEV);
        try pair.setFeeBps(31) {
            revert("fee above the 30 bps band accepted");
        } catch {}
        vm.prank(DEV);
        try pair.setFeeBps(4) {
            revert("fee below the 5 bps band accepted");
        } catch {}
        require(pair.feeBps() == 30, "unchanged");
    }

    // ------------------------------------------------------------ deploy script

    /// Audit N-1 regression: the deploy script must run to completion with the
    ///        EOA dev wallet its own docs prescribe for SEPOLIA_OWNER. Before
    ///        the fix it passed `enforceContractOwner = true` and the vault
    ///        constructor reverted OwnerNotContract() — the launch died at the
    ///        fifth deployment, and no test ever executed the script, so a
    ///        105/105 suite shipped a bricked launch path.
    function testDeployScriptRunsWithAnEoaDevWallet() public {
        vm.setEnv("SEPOLIA_OWNER", "0x000000000000000000000000000000000000dEF1");
        vm.chainId(84532); // the guard passes by chain, no override needed
        DeploySepolia script = new DeploySepolia();
        script.run();

        (
            address usdcT,
            address wethT,
            address wpitT,
            address oracleA,
            address vault,
            address p1,
            address p2,
            address p3,
            address farm,
            address stake,
            bool manual
        ) = script.d();
        require(vault != address(0) && vault.code.length > 0, "vault deployed");
        require(DealerVault(vault).owner() == DEV, "dev wallet owns the vault - an EOA is the point on a testnet");
        require(DealerVault(vault).operator() == DEV, "operator defaults to the dev wallet");
        require(usdcT != address(0) && wethT != address(0) && wpitT != address(0), "tokens deployed");
        require(oracleA != address(0) && manual, "manual-oracle fallback when no aggregator is given");
        require(p1 != address(0) && p2 != address(0) && p3 != address(0), "pools deployed");
        require(farm != address(0) && stake != address(0), "farm and stake deployed");

        // The handover actually happened: nothing stays on the deploy key.
        require(TestERC20(usdcT).owner() == DEV, "tUSDC handed over");
        require(TestERC20(wethT).owner() == DEV, "tWETH handed over");
        require(SimplePair(p1).owner() == DEV, "ETH/USDC pool handed over");
        // WPIT's mint key moves by the two-step handshake — proposed, never
        // auto-accepted, so a typo shows up between two transactions.
        require(WPIT(wpitT).pendingMinter() == DEV, "mint handover proposed to the dev wallet");
    }

    /// The relaxation follows the CHAIN, not the operator's word: with the
    ///        any-chain override set on a NON-Sepolia chain id, an EOA owner
    ///        must still revert OwnerNotContract(). This is what keeps a
    ///        `--broadcast` mistake from ever landing an EOA-owned vault on a
    ///        chain that matters.
    function testDeployScriptStaysStrictOffSepolia() public {
        vm.setEnv("SEPOLIA_OWNER", "0x000000000000000000000000000000000000dEF1");
        vm.setEnv("SEPOLIA_ALLOW_ANY_CHAIN", "1");
        vm.chainId(8453); // Base mainnet id, with the escape hatch armed
        DeploySepolia script = new DeploySepolia();
        try script.run() {
            revert("expected OwnerNotContract");
        } catch (bytes memory why) {
            require(bytes4(why) == DealerVault.OwnerNotContract.selector, "must revert OwnerNotContract");
        }
    }
}
