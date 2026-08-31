// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockERC20} from "./mocks/MockERC20.sol";
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
contract Deployer {
    MockERC20 public usdc;
    MockERC20 public weth;
    WPIT public wpit;
    DealerVault public vault;
    SimplePair public wpitUsdc;
    SimplePair public wpitEth;
    Farm public farm;
    Stake public stake;

    constructor(bool withWpit) {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        weth = new MockERC20("Wrapped Ether", "WETH", 18);
        MockOracle oracle = new MockOracle(4_000e6);
        vault = new DealerVault(IERC20(address(usdc)), IERC20(address(weth)), IOracle(address(oracle)), msg.sender, msg.sender);
        if (!withWpit) return;
        wpit = new WPIT(100_000_000 ether);
        wpitUsdc = new SimplePair(wpit, usdc, 30);
        wpitEth = new SimplePair(wpit, weth, 30);
        farm = new Farm(wpit, vault);
        stake = new Stake(wpit, vault);
        vault.setWpitFeeder(address(farm));
        wpit.setMinter(address(farm));
        wpit.acceptMinter();
    }
}
