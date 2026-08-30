// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DealerVault, IERC20, IOracle} from "../src/DealerVault.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockOracle} from "../src/mocks/MockOracle.sol";

contract CallRecorder {
    address public lastCaller;
    uint256 public pad;

    function ping(uint256 x) external {
        lastCaller = msg.sender;
        pad = x;
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
        vault.writePut(1 ether, 4000e6);
        require(vault.reservedUsdc() == 4000e6, "put lock");
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

    function testOpenShortMarksAtOracleNotCallerPrint() public {
        uint256 e0 = vault.ethBal();
        uint256 u0 = vault.usdcBal();
        vault.openShort(1 ether); // no spot argument anymore
        require(vault.ethBal() == e0 - 1 ether, "sold eth");
        require(vault.usdcBal() == u0 + 4_000e6, "credited at oracle mark");
        require(vault.reservedUsdc() == 4_000e6, "locked at oracle mark");
        oracle.set(3_000e6);
        vault.openShort(1 ether);
        require(vault.usdcBal() == u0 + 4_000e6 + 3_000e6, "re-marks with oracle");
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
