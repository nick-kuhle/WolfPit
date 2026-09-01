// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "../src/DealerVault.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {SimplePair} from "../src/SimplePair.sol";

interface Vm {
    function prank(address) external;
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
}
