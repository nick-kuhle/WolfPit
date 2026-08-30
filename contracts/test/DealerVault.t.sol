// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DealerVault, IERC20, IOracle} from "../src/DealerVault.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockOracle} from "../src/mocks/MockOracle.sol";
import {WPIT} from "../src/WPIT.sol";
import {Stake} from "../src/Stake.sol";

contract CallRecorder {
    address public lastCaller;
    uint256 public pad;

    function ping(uint256 x) external {
        lastCaller = msg.sender;
        pad = x;
    }
}

/// @notice Mock aggregator router: sells WETH for USDC at a settable price.
///         `shortPay` simulates a bad fill (pays 99%).
contract SwapRouter {
    MockERC20 public immutable weth;
    MockERC20 public immutable usdc;
    uint256 public price = 4_000e6;
    bool public shortPay;

    constructor(MockERC20 w, MockERC20 u) {
        weth = w;
        usdc = u;
    }

    function setPrice(uint256 p) external {
        price = p;
    }

    function setShortPay(bool v) external {
        shortPay = v;
    }

    function sell(uint256 amt) external {
        weth.transferFrom(msg.sender, address(this), amt);
        uint256 pay = (amt * price) / 1e18;
        if (shortPay) pay = (pay * 99) / 100;
        usdc.transfer(msg.sender, pay);
    }
}

interface Vm {
    function prank(address) external;
    function startPrank(address) external;
    function stopPrank() external;
}

contract DealerVaultTest {
    Vm constant vm = Vm(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);
    MockERC20 usdc;
    MockERC20 weth;
    MockOracle oracle;
    DealerVault vault;
    address constant ALICE = address(0xA11CE);

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        weth = new MockERC20("Wrapped Ether", "WETH", 18);
        oracle = new MockOracle(4_000e6);
        vault = new DealerVault(IERC20(address(usdc)), IERC20(address(weth)), IOracle(address(oracle)), address(this), address(this));
        usdc.mint(address(this), 2_000_000e6);
        weth.mint(address(this), 200 ether);
        usdc.mint(ALICE, 2_000_000e6);
        weth.mint(ALICE, 200 ether);
        usdc.approve(address(vault), type(uint256).max);
        weth.approve(address(vault), type(uint256).max);
        vm.startPrank(ALICE);
        usdc.approve(address(vault), type(uint256).max);
        weth.approve(address(vault), type(uint256).max);
        vm.stopPrank();
        vault.deposit(100 ether, 400_000e6);
    }

    function testDepositSeedsBalances() public view {
        require(vault.ethBal() == 100 ether, "deposit eth");
        require(vault.usdcBal() == 400_000e6, "deposit usdc");
    }

    function testWriteCallAndCover() public {
        vault.creditInsurance(20_000e6); // halt is fail-closed with no insurance
        vault.writeCall(10 ether);
        require(vault.reservedEth() == 10 ether, "reserved");
    }

    function testWriteCallNakedReverts() public {
        try vault.writeCall(101 ether) {
            revert("expected naked revert");
        } catch {}
    }

    function testUtilCapOnLong() public {
        vault.openLong(40 ether);
        try vault.openLong(1 ether) {
            revert("expected util cap");
        } catch {}
    }

    function testWritePutCashSecured() public {
        vault.creditInsurance(20_000e6); // short puts must pass the halt too
        vault.writePut(1 ether, 4000e6);
        require(vault.reservedUsdc() == 4000e6, "put lock");
    }

    /// F1 regression: writePut must fail closed with zero insurance —
    ///        short puts are short gamma.
    function testWritePutHaltsAtZeroInsurance() public {
        try vault.writePut(1 ether, 4000e6) {
            revert("expected InsuranceHalt");
        } catch {}
        vault.creditInsurance(20_000e6);
        vault.writePut(1 ether, 4000e6);
        require(vault.reservedUsdc() == 4000e6, "passes with cover");
    }

    function testWritePutNakedReverts() public {
        try vault.writePut(200 ether, 4000e6) {
            revert("expected naked put");
        } catch {}
    }

    function testPauseOnlyOwner() public {
        vm.prank(ALICE);
        try vault.pause(true) {
            revert("expected NotOwner");
        } catch {}
        vault.pause(true); // owner can
        try vault.openLong(1 ether) {
            revert("expected pause");
        } catch {}
    }

    function testRiskOpsRequireOperator() public {
        vm.prank(ALICE);
        try vault.writeCall(1 ether) {
            revert("expected NotOperator");
        } catch {}
        vm.prank(ALICE);
        try vault.openLong(1 ether) {
            revert("expected NotOperator");
        } catch {}
        vm.prank(ALICE);
        try vault.releaseCall(1 ether) {
            revert("expected NotOperator");
        } catch {}
        vm.prank(ALICE);
        try vault.creditInsurance(1e6) {
            revert("expected NotOwner");
        } catch {}
    }

    function testHaltWhenNoInsurance() public {
        // Worst case must fail closed: zero insurance halts new short gamma.
        try vault.writeCall(1 ether) {
            revert("expected halt at zero insurance");
        } catch {}
    }

    function testInsuranceHalt() public {
        vault.creditInsurance(1); // tiny vs NAV
        try vault.writeCall(1 ether) {
            revert("expected halt");
        } catch {}
        vault.creditInsurance(20_000e6); // 2.5% of 800k NAV
        vault.writeCall(1 ether); // passes now
    }

    function testHaltWhenOracleDead() public {
        vault.creditInsurance(20_000e6);
        oracle.set(0);
        try vault.writeCall(1 ether) {
            revert("expected halt on dead oracle");
        } catch {}
    }

    function _routerFixture() internal returns (SwapRouter router) {
        router = new SwapRouter(weth, usdc);
        usdc.mint(address(router), 10_000_000e6);
        vault.allowTarget(address(router), true);
        vault.setAllowance(IERC20(address(weth)), address(router), type(uint256).max);
    }

    /// Atomic openShort: router swap + booking in ONE tx, booked from
    ///        real balance deltas, reservation at the ORACLE mark.
    function testOpenShortAtomicSwapsThenBooks() public {
        SwapRouter router = _routerFixture();
        uint256 e0 = vault.ethBal();
        uint256 u0 = vault.usdcBal();
        bytes memory data = abi.encodeWithSignature("sell(uint256)", 1 ether);
        vault.openShort(1 ether, address(router), data, 3_000e6);
        require(vault.ethBal() == e0 - 1 ether, "sold eth");
        require(vault.usdcBal() == u0 + 4_000e6, "credited actual swap proceeds");
        require(vault.reservedUsdc() == 4_000e6, "locked at oracle mark");
        oracle.set(3_000e6);
        vault.openShort(1 ether, address(router), data, 3_000e6);
        require(vault.reservedUsdc() == 4_000e6 + 3_000e6, "locks at new oracle mark");
    }

    /// A bad fill (99% payout) with a strict min-out reverts EVERYTHING.
    function testOpenShortSlippageRevertsFully() public {
        SwapRouter router = _routerFixture();
        router.setShortPay(true);
        bytes memory data = abi.encodeWithSignature("sell(uint256)", 1 ether);
        try vault.openShort(1 ether, address(router), data, 4_000e6) {
            revert("expected Slippage");
        } catch {}
        require(vault.ethBal() == 100 ether, "full rollback: eth");
        require(vault.usdcBal() == 400_000e6, "full rollback: usdc");
        require(vault.reservedUsdc() == 0, "full rollback: reservation");
    }

    function testOpenShortRequiresAllowlistedRouter() public {
        SwapRouter router = _routerFixture();
        bytes memory data = abi.encodeWithSignature("sell(uint256)", 1 ether);
        vm.startPrank(ALICE);
        usdc.mint(ALICE, 10_000_000e6);
        vm.stopPrank();
        SwapRouter rogue = new SwapRouter(weth, usdc);
        try vault.openShort(1 ether, address(rogue), data, 0) {
            revert("expected BadTarget");
        } catch {}
    }

    /// Reconcile syncs counters up after an unbooked swap; a loss below
    ///        reserved amounts cannot be reconciled (fail loud, never absorb).
    function testReconcileBalances() public {
        usdc.mint(address(vault), 123e6); // drift: tokens arrived outside ledger
        vault.reconcileBalances();
        require(vault.usdcBal() == 400_000e6 + 123e6, "synced up");
        vault.creditInsurance(20_000e6);
        vault.writeCall(10 ether); // reserves 10 of the 100 WETH in the vault
        vm.prank(address(vault));
        weth.transfer(address(0xDEAD), 95 ether); // real ETH now 5 < 10 reserved
        try vault.reconcileBalances() {
            revert("expected UnreconciledLoss");
        } catch {}
    }

    function testReconcileOnlyOperator() public {
        vm.prank(ALICE);
        try vault.reconcileBalances() {
            revert("expected NotOperator");
        } catch {}
    }

    /// Junior slash order is now reachable: vault pulls staked WPIT into
    ///        insuranceWpit, capped at the stake contract's total.
    function testSlashInsuranceJunior() public {
        WPIT wpit = new WPIT(100_000_000 ether);
        Stake stake = new Stake(wpit, vault);
        vault.setStake(address(stake));
        wpit.setMinter(address(this));
        wpit.mint(address(this), 50 ether);
        wpit.approve(address(stake), type(uint256).max);
        stake.stake(50 ether);
        vault.slashInsuranceJunior(20 ether);
        require(vault.insuranceWpit() == 20 ether, "slashed into insurance");
        vault.slashInsuranceJunior(1_000 ether); // capped at stake total (30 left)
        require(vault.insuranceWpit() == 20 ether + 30 ether, "capped at total");
        require(stake.total() == 0, "stake drained");
    }

    function testDepositSharesAreValueBasedNotUnitSummed() public {
        // 1 ETH (≈ $4k) and 4000e6 USDC are the same value: the old unit-sum
        // bug minted 1e18 vs 4e9 "shares" (9 orders of magnitude apart).
        uint256 before = vault.shareOf(address(this));
        vault.deposit(1 ether, 0);
        uint256 s1 = vault.shareOf(address(this)) - before;
        vm.startPrank(ALICE);
        vault.deposit(0, 4_000e6);
        uint256 s2 = vault.shareOf(ALICE);
        vm.stopPrank();
        require(s1 >= 3_990_000_000 && s1 <= 4_010_000_000, "s1 ~= 4000e6 shares for $4k of ETH");
        require(s2 >= 3_990_000_000 && s2 <= 4_010_000_000, "s2 ~= 4000e6 shares for $4k of USDC");
        uint256 hi = s1 > s2 ? s1 : s2;
        uint256 lo = s1 > s2 ? s2 : s1;
        require((hi - lo) * 100 / hi < 2, "same value within 2% (NAV grew between deposits)");
    }

    function testFirstDepositTooSmallReverts() public {
        MockOracle o2 = new MockOracle(4_000e6);
        DealerVault v2 = new DealerVault(IERC20(address(usdc)), IERC20(address(weth)), IOracle(address(o2)), address(this), address(this));
        usdc.approve(address(v2), type(uint256).max);
        try v2.deposit(0, 100e6) {
            revert("expected FirstDepositTooSmall");
        } catch {}
        v2.deposit(0, 5_000e6); // exactly the floor passes
    }

    function testExecOnlyAllowedTargets() public {
        CallRecorder rec = new CallRecorder();
        bytes memory data = abi.encodeWithSignature("ping(uint256)", 7);
        vm.prank(ALICE);
        try vault.exec(address(rec), data) {
            revert("expected NotOperator");
        } catch {}
        try vault.exec(address(rec), data) {
            revert("expected BadTarget");
        } catch {}
        vault.allowTarget(address(rec), true);
        vault.exec(address(rec), data);
        require(rec.pad() == 7, "exec ran");
        require(rec.lastCaller() == address(vault), "vault is msg.sender");
    }
}
