// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TestERC20} from "./TestERC20.sol";
import {MockOracle} from "./mocks/MockOracle.sol";
import {IERC20, IOracle} from "./DealerVault.sol";
import {WPIT} from "./WPIT.sol";
import {DealerVault} from "./DealerVault.sol";
import {SimplePair} from "./SimplePair.sol";
import {Farm} from "./Farm.sol";
import {Stake} from "./Stake.sol";

/// @notice One-shot TEST deploy (local/anvil). Base mainnet uses
///         script/DeployBase.s.sol with real WETH/USDC and a ChainlinkOracle.
///         withWpit = false deploys the launch shape: vault only, no token.
///
///         The Deployer is the vault's owner during construction so it can run
///         the owner-gated wiring (setWpitFeeder, setStake) itself; it hands
///         ownership back to the deployer via the vault's two-step transfer at
///         the end. The deployer must complete the handoff with
///         `vault.acceptOwnership()` (operator is theirs from the start).
contract Deployer {
    TestERC20 public usdc;
    TestERC20 public weth;
    WPIT public wpit;
    DealerVault public vault;
    SimplePair public wpitUsdc;
    SimplePair public wpitEth;
    Farm public farm;
    Stake public stake;

    constructor(bool withWpit) {
        usdc = new TestERC20("USD Coin", "USDC", 6);
        weth = new TestERC20("Wrapped Ether", "WETH", 18);
        MockOracle oracle = new MockOracle(4_000e6);
        vault = new DealerVault(
            IERC20(address(usdc)),
            IERC20(address(weth)),
            IOracle(address(oracle)),
            address(this), // owner during construction so the wiring below works
            msg.sender // operator: the deployer, from the start
        );
        if (!withWpit) {
            vault.transferOwnership(msg.sender);
            return;
        }
        wpit = new WPIT(100_000_000 ether);
        wpitUsdc = new SimplePair(wpit, usdc, 30);
        wpitEth = new SimplePair(wpit, weth, 30);
        farm = new Farm(wpit, vault);
        stake = new Stake(wpit, vault);
        vault.setWpitFeeder(address(farm));
        vault.setStake(address(stake)); // junior slash must be reachable on the token-era path
        wpit.setMinter(address(farm));
        wpit.acceptMinter();
        vault.transferOwnership(msg.sender);
    }
}
