// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockERC20} from "./mocks/MockERC20.sol";
import {WPIT} from "./WPIT.sol";
import {DealerVault} from "./DealerVault.sol";
import {SimplePair} from "./SimplePair.sol";
import {Farm} from "./Farm.sol";
import {Stake} from "./Stake.sol";

/// @notice One-shot TEST deploy. Unfunded. Base-shaped.
contract Deployer {
    MockERC20 public usdc;
    MockERC20 public weth;
    WPIT public wpit;
    DealerVault public vault;
    SimplePair public wpitUsdc;
    SimplePair public wpitEth;
    Farm public farm;
    Stake public stake;

    constructor() {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        weth = new MockERC20("Wrapped Ether", "WETH", 18);
        wpit = new WPIT(100_000_000 ether);
        vault = new DealerVault(usdc, weth);
        wpitUsdc = new SimplePair(wpit, usdc, 30);
        wpitEth = new SimplePair(wpit, weth, 30);
        farm = new Farm(wpit, vault);
        stake = new Stake(wpit, vault);
        wpit.setMinter(address(farm));
    }
}
