// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DealerVault} from "../src/DealerVault.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {WPIT} from "../src/WPIT.sol";
import {SimplePair} from "../src/SimplePair.sol";
import {Farm} from "../src/Farm.sol";
import {Stake} from "../src/Stake.sol";

contract SystemTest {
    MockERC20 usdc;
    MockERC20 weth;
    WPIT wpit;
    DealerVault vault;
    SimplePair pairUsdc;
    SimplePair pairEth;
    Farm farm;
    Stake stake;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        weth = new MockERC20("Wrapped Ether", "WETH", 18);
        wpit = new WPIT(100_000_000 ether);
        vault = new DealerVault(usdc, weth);
        pairUsdc = new SimplePair(wpit, usdc, 30);
        pairEth = new SimplePair(wpit, weth, 30);
        farm = new Farm(wpit, vault);
        stake = new Stake(wpit, vault);
        usdc.mint(address(this), 2_000_000e6);
        weth.mint(address(this), 200 ether);
        usdc.approve(address(vault), type(uint256).max);
        weth.approve(address(vault), type(uint256).max);
        vault.deposit(100 ether, 400_000e6);
    }

    function testFarmNotifyAndHarvestTax() public {
        wpit.setMinter(address(this));
        wpit.mint(address(this), 1 ether);
        wpit.setMinter(address(farm));
        farm.notify(100 ether, 4_000);
        farm.accrue(address(this), 10_000);
        (uint256 net, uint256 tax) = farm.harvest();
        require(tax * 99 == net, "1% tax");
        require(vault.insuranceWpit() == tax, "ins");
    }

    function testPairAddRemove() public {
        wpit.setMinter(address(this));
        wpit.mint(address(this), 10_000 ether);
        wpit.approve(address(pairUsdc), type(uint256).max);
        usdc.approve(address(pairUsdc), type(uint256).max);
        uint256 sh = pairUsdc.add(1_000 ether, 1_000e6);
        require(sh > 0, "shares");
        pairUsdc.remove(sh);
    }

    function testStakeRoundtrip() public {
        wpit.setMinter(address(this));
        wpit.mint(address(this), 50 ether);
        wpit.approve(address(stake), type(uint256).max);
        stake.stake(50 ether);
        require(stake.total() == 50 ether, "staked");
        stake.unstake(50 ether);
    }

    function testInsuranceHalt() public {
        vault.creditInsurance(1); // tiny vs NAV
        try vault.writeCall(1 ether) {
            revert("expected halt");
        } catch {}
    }
}
