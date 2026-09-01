// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DealerVault, IERC20, IOracle} from "../src/DealerVault.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockOracle} from "../src/mocks/MockOracle.sol";
import {WPIT} from "../src/WPIT.sol";
import {SimplePair} from "../src/SimplePair.sol";
import {Farm} from "../src/Farm.sol";
import {Stake} from "../src/Stake.sol";

interface Vm {
    function prank(address) external;
    function warp(uint256) external;
}

contract SystemTest {
    MockERC20 usdc;
    MockERC20 weth;
    MockOracle oracle;
    WPIT wpit;
    DealerVault vault;
    SimplePair pairUsdc;
    SimplePair pairEth;
    Farm farm;
    Stake stake;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        weth = new MockERC20("Wrapped Ether", "WETH", 18);
        oracle = new MockOracle(4_000e6);
        wpit = new WPIT(100_000_000 ether);
        vault = new DealerVault(IERC20(address(usdc)), IERC20(address(weth)), IOracle(address(oracle)), address(this), address(this), true);
        pairUsdc = new SimplePair(wpit, usdc, 30);
        pairEth = new SimplePair(wpit, weth, 30);
        farm = new Farm(wpit, vault);
        stake = new Stake(wpit, vault);
        vault.setWpitFeeder(address(farm));
        usdc.mint(address(this), 2_000_000e6);
        weth.mint(address(this), 200 ether);
        usdc.approve(address(vault), type(uint256).max);
        weth.approve(address(vault), type(uint256).max);
        vault.deposit(100 ether, 400_000e6);
    }

    function testFarmNotifyAndHarvestTax() public {
        wpit.setMinter(address(this));
        wpit.acceptMinter();
        wpit.mint(address(this), 1 ether);
        wpit.setMinter(address(farm));
        wpit.acceptMinter();
        farm.setShare(address(this), 10_000);
        farm.notify(100 ether);
        farm.accrue(address(this));
        (uint256 net, uint256 tax) = farm.harvest();
        require(tax * 99 == net, "1% tax");
        require(vault.insuranceWpit() == tax, "ins");
    }

    function testFarmNotifyIsOwnerOnly() public {
        wpit.setMinter(address(farm));
        wpit.acceptMinter();
        vm.prank(address(0xBAD));
        try farm.notify(1 ether) {
            revert("expected NotOwner");
        } catch {}
        vm.prank(address(0xBAD));
        try farm.accrue(address(0xBEEF)) {
            revert("expected NotOwner on accrue");
        } catch {}
        vm.prank(address(0xBAD));
        try farm.setShare(address(0xBEEF), 5_000) {
            revert("expected NotOwner on setShare");
        } catch {}
    }

    Vm constant vm = Vm(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);

    function testPairAddRemove() public {
        wpit.setMinter(address(this));
        wpit.acceptMinter();
        wpit.mint(address(this), 10_000 ether);
        wpit.approve(address(pairUsdc), type(uint256).max);
        usdc.approve(address(pairUsdc), type(uint256).max);
        uint256 sh = pairUsdc.add(1_000 ether, 1_000e6);
        require(sh > 0, "shares");
        pairUsdc.remove(sh);
        // owner-only fee; non-owner cannot change it
        vm.prank(address(0xBAD));
        try pairUsdc.setFeeBps(10) {
            revert("expected NotOwner on fee");
        } catch {}
        pairUsdc.setFeeBps(10);
        require(pairUsdc.feeBps() == 10, "owner sets fee");
    }

    /// B1 regression: the first add must count lpSupply exactly once. The old
    ///        code set lpSupply = a0 in the first-add branch AND ran the shared
    ///        `lpSupply += shares` tail, so total supply was ~2·a0 and a first
    ///        LP got back only ~half their deposit on a round-trip.
    function testPairFirstAddRoundTripIsFair() public {
        wpit.setMinter(address(this));
        wpit.acceptMinter();
        wpit.mint(address(this), 10_000 ether);
        wpit.approve(address(pairUsdc), type(uint256).max);
        usdc.approve(address(pairUsdc), type(uint256).max);
        uint256 sh = pairUsdc.add(1_000 ether, 1_000e6);
        uint256 burn = pairUsdc.MINIMUM_LIQUIDITY();
        require(sh == 1_000 ether - burn, "first add mints a0 minus the burn");
        require(pairUsdc.lpSupply() == 1_000 ether, "lpSupply counts the burn exactly once");
        uint256 r0 = pairUsdc.reserve0();
        uint256 r1 = pairUsdc.reserve1();
        (uint256 back0, uint256 back1) = pairUsdc.remove(sh);
        // Pre-fix this was ~50% of the deposit; the burn is the only intended cost.
        require(back0 > 999 ether, "round trip keeps the WPIT leg (was ~half)");
        require(back1 >= 1_000e6 - (burn * r1) / r0 - 1, "round trip keeps the USDC leg");
        require(pairUsdc.reserve0() == burn, "burn stays locked in the pool");
        require(pairUsdc.lpSupply() == burn, "only the burn remains in supply");
    }

    function testStakeRoundtrip() public {
        wpit.setMinter(address(this));
        wpit.acceptMinter();
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
    function testFarmAccrueDoesNotDoublePay() public {
        wpit.setMinter(address(farm));
        wpit.acceptMinter();
        farm.setShare(address(this), 10_000);
        farm.notify(100 ether);
        farm.accrue(address(this));
        require(farm.pending(address(this)) == 100 ether, "first accrual");
        farm.notify(100 ether);
        farm.accrue(address(this));
        require(farm.pending(address(this)) == 200 ether, "second accrual adds once");
        farm.accrue(address(this));
        require(farm.pending(address(this)) == 200 ether, "no-op re-accrue");
    }

    /// F5: shareBps is capped at 10_000.
    function testFarmShareBpsCap() public {
        try farm.setShare(address(this), 10_001) {
            revert("expected BadBps");
        } catch {}
    }

    /// F5: an imbalanced add cannot mint shares off one leg and redeem
    ///        them off both.
    function testPairImbalancedAddCannotSteal() public {
        wpit.setMinter(address(this));
        wpit.acceptMinter();
        wpit.mint(address(this), 100_000 ether);
        wpit.approve(address(pairUsdc), type(uint256).max);
        usdc.approve(address(pairUsdc), type(uint256).max);
        pairUsdc.add(10_000 ether, 10_000e6); // balanced seed by this contract
        uint256 a0 = pairUsdc.reserve0();
        uint256 a1 = pairUsdc.reserve1();
        // Attacker: tiny WPIT, huge USDC.
        uint256 sh = pairUsdc.add(1 ether, 900_000e6);
        uint256 back0 = (sh * pairUsdc.reserve0()) / pairUsdc.lpSupply();
        require(back0 <= 2 ether, "cannot exit with more base than deposited");
        require(sh < 100 ether, "shares priced off the small leg");
        pairUsdc.remove(sh); // no reverts, no profit
        require(pairUsdc.reserve0() > a0 / 2 && pairUsdc.reserve1() > a1 / 2, "seed intact");
    }

    /// F5: vault can actually draw the junior tranche now.
    function testVaultSlashInsuranceCapsAtTotal() public {
        wpit.setMinter(address(this));
        wpit.acceptMinter();
        wpit.mint(address(this), 50 ether);
        wpit.approve(address(stake), type(uint256).max);
        stake.stake(50 ether);
        vault.setStake(address(stake));
        vault.slashInsuranceJunior(1_000 ether); // capped at 50
        require(vault.insuranceWpit() == 50 ether, "capped at stake total");
        require(stake.total() == 0, "drained");
    }

    /// FARM.md: production cooldown (7 days) is enforced once the owner sets
    /// it; the TEST default (0) stays instant.
    function testStakeCooldownEnforced() public {
        stake.setCooldown(7 days);
        wpit.setMinter(address(this));
        wpit.acceptMinter();
        wpit.mint(address(this), 10 ether);
        wpit.approve(address(stake), type(uint256).max);
        stake.stake(1 ether);
        vm.warp(block.timestamp + 3 days);
        try stake.unstake(0.5 ether) {
            revert("cooldown not enforced");
        } catch {}
        vm.warp(block.timestamp + 5 days); // +8d total: lock expired
        stake.unstake(0.5 ether);
        require(stake.staked(address(this)) == 0.5 ether, "partial unstake after lock");
        require(stake.total() == 0.5 ether, "total tracks partial");
    }

    /// WPIT minter cannot be moved to the zero address (and the move is loud).
    function testWpitMinterRejectsZero() public {
        try wpit.setMinter(address(0)) {
            revert("expected ZeroMinter");
        } catch {}
        require(wpit.minter() == address(this), "minter unchanged");
        require(wpit.pendingMinter() == address(0), "zero never proposed");
    }

    /// WPIT minter transfer is two-step: propose, then accept. Between the
    /// two, the old minter still mints and the pending address is visible.
    function testWpitMinterTwoStep() public {
        wpit.setMinter(address(0xACE));
        require(wpit.minter() == address(this), "minter unchanged until accept");
        require(wpit.pendingMinter() == address(0xACE), "pending visible");
        wpit.mint(address(this), 1 ether); // old minter still active
        vm.prank(address(0xBAD));
        try wpit.acceptMinter() {
            revert("stranger cannot accept");
        } catch {}
        wpit.acceptMinter();
        require(wpit.minter() == address(0xACE), "accepted");
        require(wpit.pendingMinter() == address(0), "pending cleared");
    }
}
