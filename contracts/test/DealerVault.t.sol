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

contract DrainRouter {
    IERC20 public immutable token;

    constructor(IERC20 token_) {
        token = token_;
    }

    function drain(address from, uint256 amount) external {
        token.transferFrom(from, address(this), amount);
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
        wpit.acceptMinter();
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

    /// Regression (audit A, HIGH): openShort must only spend FREE ETH.
    ///        Before the fix it checked raw ethBal, so a hedge-sell could
    ///        consume collateral reserved by writeCall and leave the vault
    ///        naked (ethBal < reservedEth).
    function testOpenShortCannotSpendCallCollateral() public {
        SwapRouter router = _routerFixture();
        vault.creditInsurance(20_000e6);
        vault.writeCall(40 ether); // reservedEth = 40, freeEth = 60
        bytes memory data = abi.encodeWithSignature("sell(uint256)", 65 ether);
        try vault.openShort(65 ether, address(router), data, 0) {
            revert("expected NakedCall: 65 > freeEth 60");
        } catch {}
        require(vault.ethBal() == 100 ether, "rollback intact");
        // At the α cap the ETH side has no room: even a sale of exactly the
        // free inventory would push utilisation past α (40/40 = 100%) — the
        // inventory law is stricter than bare coverage.
        data = abi.encodeWithSignature("sell(uint256)", 60 ether);
        try vault.openShort(60 ether, address(router), data, 0) {
            revert("expected UtilCap: ETH util would exceed alpha");
        } catch {}
        require(vault.ethBal() == 100 ether, "util-cap rollback intact");
        // Releasing call cover frees room: at util 20/100 = 20%, selling 40
        // ETH lands at 20/60 = 33% — inside α and still covered.
        vault.releaseCall(20 ether); // reservedEth 40 -> 20
        data = abi.encodeWithSignature("sell(uint256)", 40 ether);
        vault.openShort(40 ether, address(router), data, 150_000e6);
        require(vault.ethBal() == 60 ether, "sold within alpha");
        require(vault.ethBal() >= vault.reservedEth(), "calls stay covered");
    }

    /// Regression (audit, F16 follow-up): creditInsurance pulls REAL USDC and
    ///        keeps it on a segregated ledger — no unbacked entries, and
    ///        reconcile must not fold insurance into the trading balance.
    function testCreditInsuranceIsTokenBackedAndSegregated() public {
        uint256 balBefore = usdc.balanceOf(address(vault));
        uint256 mineBefore = usdc.balanceOf(address(this));
        vault.creditInsurance(20_000e6);
        require(usdc.balanceOf(address(vault)) == balBefore + 20_000e6, "tokens moved in");
        require(usdc.balanceOf(address(this)) == mineBefore - 20_000e6, "pulled from owner");
        require(vault.insuranceUsdc() == 20_000e6, "ledger credited");
        require(vault.usdcBal() == 400_000e6, "trading ledger untouched");
        vault.reconcileBalances();
        require(vault.usdcBal() == 400_000e6, "reconcile excludes insurance");
        try vault.creditInsurance(0) {
            revert("expected Zero");
        } catch {}
    }

    /// Regression: LP withdraw path — pro-rata both legs, vault-favoring
    ///        rounding via the virtual-share offset.
    function testWithdrawProRataBothLegs() public {
        uint256 my = vault.shareOf(address(this));
        uint256 e0 = weth.balanceOf(address(this));
        uint256 u0 = usdc.balanceOf(address(this));
        vault.withdraw(my / 2);
        uint256 ethOut = weth.balanceOf(address(this)) - e0;
        uint256 usdcOut = usdc.balanceOf(address(this)) - u0;
        // ~50 ETH / ~200k USDC, shaved slightly by the virtual-share offset.
        require(ethOut > 49.99 ether && ethOut <= 50 ether, "eth leg pro-rata");
        require(usdcOut > 199_900e6 && usdcOut <= 200_000e6, "usdc leg pro-rata");
        require(vault.shareOf(address(this)) == my - my / 2, "shares burned");
        try vault.withdraw(my) {
            revert("expected InsufficientShares");
        } catch {}
    }

    /// A pause must stop new risk, not trap an LP. Safe withdrawals remain
    /// available while paused and still run the collateral checks.
    function testWithdrawAllowedWhilePaused() public {
        uint256 my = vault.shareOf(address(this));
        vault.pause(true);
        vault.withdraw(my / 2);
        require(vault.shareOf(address(this)) == my - my / 2, "paused withdrawal burned shares");
        vault.pause(false);
    }

    /// Insurance is a hard floor on generic router execution: trading inventory
    /// may move, but an allowlisted target cannot spend the reserve.
    function testExecCannotSpendInsuranceReserve() public {
        vault.creditInsurance(20_000e6);
        DrainRouter router = new DrainRouter(IERC20(address(usdc)));
        vault.allowTarget(address(router), true);
        vault.setAllowance(IERC20(address(usdc)), address(router), type(uint256).max);
        bytes memory data = abi.encodeWithSignature("drain(address,uint256)", address(vault), 400_001e6);
        try vault.exec(address(router), data) {
            revert("expected InsuranceSpent");
        } catch {}
        require(usdc.balanceOf(address(vault)) == 420_000e6, "insurance drain rolled back");
        require(vault.insuranceUsdc() == 20_000e6, "insurance ledger intact");
    }

    /// Hedge-sales must not push ETH-side utilisation past α: the sale shrinks
    ///        the balance that backs written calls, even though it stays
    ///        "covered" (size <= freeEth).
    function testOpenShortCannotBreachEthUtilCap() public {
        SwapRouter router = _routerFixture();
        vault.creditInsurance(20_000e6);
        vault.writeCall(40 ether); // ETH util exactly at the α cap
        bytes memory data = abi.encodeWithSignature("sell(uint256)", 60 ether);
        try vault.openShort(60 ether, address(router), data, 0) {
            revert("expected UtilCap: ETH util would exceed alpha after the sale");
        } catch {}
        require(vault.ethBal() == 100 ether, "no ETH left the vault");
    }

    /// With headroom on the ETH side, hedge-sales inside α still work.
    function testOpenShortRespectsEthUtilWithHeadroom() public {
        SwapRouter router = _routerFixture();
        vault.creditInsurance(20_000e6);
        vault.writeCall(20 ether); // util 20%: room for a 40 ETH hedge-sale
        bytes memory data = abi.encodeWithSignature("sell(uint256)", 40 ether);
        vault.openShort(40 ether, address(router), data, 0);
        require(vault.ethBal() == 60 ether, "sold 40 ETH");
        require(vault.reservedEth() == 20 ether, "cover intact");
        require(vault.utilBps() == 3_333, "ETH util within alpha (20/60 = 33.33%)");
    }

    /// exec must not be able to drain WETH from under written calls.
    function testExecCannotSpendWethCover() public {
        vault.creditInsurance(20_000e6);
        vault.writeCall(40 ether); // reservedEth = 40
        DrainRouter router = new DrainRouter(IERC20(address(weth)));
        vault.allowTarget(address(router), true);
        vault.setAllowance(IERC20(address(weth)), address(router), type(uint256).max);
        bytes memory data = abi.encodeWithSignature("drain(address,uint256)", address(vault), 61 ether);
        try vault.exec(address(router), data) {
            revert("expected CoverSpent: WETH below reservedEth");
        } catch {}
        require(weth.balanceOf(address(vault)) == 100 ether, "WETH cover intact");
    }

    /// exec must not drain trading USDC below reservedUsdc either (the
    ///        insurance floor alone would not stop this).
    function testExecCannotSpendReservedUsdc() public {
        vault.creditInsurance(20_000e6);
        vault.writePut(10 ether, 4000e6); // reservedUsdc = 40_000e6
        DrainRouter router = new DrainRouter(IERC20(address(usdc)));
        vault.allowTarget(address(router), true);
        vault.setAllowance(IERC20(address(usdc)), address(router), type(uint256).max);
        // 400k trading + 20k insurance = 420k total; draining 380,001 leaves
        // 39,999 total => trading = 19,999 < reservedUsdc 40,000.
        bytes memory data = abi.encodeWithSignature("drain(address,uint256)", address(vault), 380_001e6);
        try vault.exec(address(router), data) {
            revert("expected CoverSpent: trading USDC below reservedUsdc");
        } catch {}
        require(usdc.balanceOf(address(vault)) == 420_000e6, "trading cover intact");
    }

    /// maxWithdraw is the largest exit that keeps BOTH legs inside α; it must
    ///        be exactly right — the max itself passes, one share more reverts.
    function testMaxWithdrawRespectsBothAlphaLaws() public {
        uint256 my = vault.shareOf(address(this));
        vault.creditInsurance(20_000e6);
        // At the ETH α-cap no exit is possible.
        vault.writeCall(40 ether);
        require(vault.maxWithdraw(address(this)) == 0, "no exit at the alpha cap");
        vault.releaseCall(40 ether);
        // Flat book: the full position is withdrawable.
        require(vault.maxWithdraw(address(this)) == my, "full exit on a flat book");
        // Half-reserved: the preview is the tight boundary.
        vault.writeCall(20 ether);
        uint256 m = vault.maxWithdraw(address(this));
        require(m > 0 && m < my, "max is between 0 and full");
        try vault.withdraw(m + 1) {
            revert("expected UtilCap: one share over the max");
        } catch {}
        vault.withdraw(m); // the max itself must pass
        require(vault.reservedEth() * 10_000 <= vault.ethBal() * 4000, "post-max util within alpha");
    }

    /// Withdrawals must not break the inventory law: with reservations at the
    ///        α-cap, any exit that shrinks the backing balance reverts.
    function testWithdrawBlockedWhenItWouldStrandReserves() public {
        vault.creditInsurance(20_000e6);
        vault.writeCall(40 ether); // exactly at α = 40% of 100 ETH
        uint256 my = vault.shareOf(address(this));
        try vault.withdraw(my / 8) {
            revert("expected UtilCap");
        } catch {}
        // Releasing the reservation frees the exit.
        vault.releaseCall(40 ether);
        vault.withdraw(my / 8);
    }

    /// Regression (audit B, MEDIUM): slash is pro-rata across stakers. Before
    ///        the fix only `total` was reduced: the first unstaker exited at
    ///        full pre-slash size and the second was bricked by underflow.
    function testStakeSlashIsProRata() public {
        WPIT wpit = new WPIT(100_000_000 ether);
        Stake stake = new Stake(wpit, vault);
        vault.setStake(address(stake));
        wpit.setMinter(address(this));
        wpit.acceptMinter();
        wpit.mint(address(this), 1_000 ether);
        wpit.mint(ALICE, 1_000 ether);
        wpit.approve(address(stake), type(uint256).max);
        stake.stake(1_000 ether);
        vm.startPrank(ALICE);
        wpit.approve(address(stake), type(uint256).max);
        stake.stake(1_000 ether);
        vm.stopPrank();
        require(stake.total() == 2_000 ether, "both staked");

        vault.slashInsuranceJunior(1_000 ether); // 50% of the pool
        require(stake.total() == 1_000 ether, "half slashed");
        require(stake.staked(address(this)) == 500 ether, "loss lands pro-rata (me)");
        require(stake.staked(ALICE) == 500 ether, "loss lands pro-rata (alice)");

        // Neither staker can exit at pre-slash size.
        try stake.unstake(1_000 ether) {
            revert("expected bal revert at pre-slash size");
        } catch {}
        // Both can exit their post-slash balance — nobody is bricked.
        stake.unstake(500 ether);
        vm.prank(ALICE);
        stake.unstake(500 ether);
        require(stake.total() == 0, "pool empty");
        require(wpit.balanceOf(address(stake)) == 0, "no stranded tokens");
    }

    /// A 100% slash wipes the share ledger; a fresh epoch starts clean and
    ///        wiped stakers cannot claim against new deposits.
    function testStakeFullSlashStartsCleanEpoch() public {
        WPIT wpit = new WPIT(100_000_000 ether);
        Stake stake = new Stake(wpit, vault);
        vault.setStake(address(stake));
        wpit.setMinter(address(this));
        wpit.acceptMinter();
        wpit.mint(address(this), 1_000 ether);
        wpit.mint(ALICE, 1_000 ether);
        wpit.approve(address(stake), type(uint256).max);
        stake.stake(1_000 ether);
        vault.slashInsuranceJunior(10_000 ether); // caps at 1_000: pool -> 0
        require(stake.total() == 0, "fully drained");
        require(stake.staked(address(this)) == 0, "old shares worthless");
        // A new staker gets a clean pool, not diluted by wiped shares.
        vm.startPrank(ALICE);
        wpit.approve(address(stake), type(uint256).max);
        stake.stake(1_000 ether);
        require(stake.staked(ALICE) == 1_000 ether, "fresh epoch is 1:1");
        stake.unstake(1_000 ether);
        require(wpit.balanceOf(ALICE) == 1_000 ether, "full exit");
        vm.stopPrank();
        // The wiped staker still cannot withdraw anything.
        try stake.unstake(1 ether) {
            revert("expected bal revert for wiped staker");
        } catch {}
    }

    /// A near-full slash leaves dust; the share ledger must wipe (like a full
    ///        slash) so the next stake cannot mint astronomical share counts.
    function testStakeDustWipeStartsCleanEpoch() public {
        WPIT wpit = new WPIT(100_000_000 ether);
        Stake stake = new Stake(wpit, vault);
        vault.setStake(address(stake));
        wpit.setMinter(address(this));
        wpit.acceptMinter();
        wpit.mint(address(this), 1_000 ether);
        wpit.mint(ALICE, 2_000 ether); // enough for a stake + a post-slash restake
        wpit.approve(address(stake), type(uint256).max);
        stake.stake(1_000 ether);
        vm.startPrank(ALICE);
        wpit.approve(address(stake), type(uint256).max);
        stake.stake(1_000 ether);
        vm.stopPrank();
        vault.slashInsuranceJunior(2_000 ether - 1); // leaves 1 wei of dust
        require(stake.total() == 1, "dust left behind");
        require(stake.staked(ALICE) == 0, "dust shares wiped (stale epoch)");
        // A fresh stake starts a clean 1:1 epoch instead of inflating shares.
        vm.startPrank(ALICE);
        stake.stake(1_000 ether);
        require(stake.staked(ALICE) >= 1_000 ether, "fresh stake redeemable");
        stake.unstake(1_000 ether);
        require(wpit.balanceOf(ALICE) == 1_000 ether, "full exit");
        vm.stopPrank();
    }
}
