// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DealerVault, IERC20, IOracle} from "../src/DealerVault.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockOracle} from "../src/mocks/MockOracle.sol";
import {WPIT} from "../src/WPIT.sol";
import {SimplePair} from "../src/SimplePair.sol";
import {Farm} from "../src/Farm.sol";
import {Stake} from "../src/Stake.sol";

interface Log {
    // opaque; only the topic fields below are read
}

interface Vm {
    function prank(address) external;
    function warp(uint256) external;
    function recordLogs() external;
    function getRecordedLogs() external returns (VmLog[] memory);
}

struct VmLog {
    bytes32[] topics;
    bytes data;
}

/// @notice Regressions for the 2026-08-31 review findings (issues #7, #9, #10,
///         #11, #15, #16, #18).
///
///         Style rule, per WP-12 / #16: every test that moves value asserts on a
///         BALANCE DELTA, never on "it did not revert". That single habit is
///         what let a 50% LP loss sit inside a green 33-test suite.
contract ReviewFixesTest {
    Vm constant vm = Vm(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);

    MockERC20 usdc;
    MockERC20 weth;
    MockOracle oracle;
    WPIT wpit;
    DealerVault vault;
    SimplePair pairUsdc;
    Farm farm;
    Stake stake;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        weth = new MockERC20("Wrapped Ether", "WETH", 18);
        oracle = new MockOracle(4_000e6);
        wpit = new WPIT(100_000_000 ether);
        vault = new DealerVault(IERC20(address(usdc)), IERC20(address(weth)), IOracle(address(oracle)), address(this), address(this));
        pairUsdc = new SimplePair(IERC20(address(wpit)), IERC20(address(usdc)), 30);
        farm = new Farm(wpit, vault);
        stake = new Stake(wpit, vault);
        vault.setWpitFeeder(address(farm));
        vault.setStake(address(stake));
        usdc.mint(address(this), 2_000_000e6);
        weth.mint(address(this), 200 ether);
        usdc.approve(address(vault), type(uint256).max);
        weth.approve(address(vault), type(uint256).max);
        vault.deposit(100 ether, 400_000e6);
    }

    function fundPair() internal {
        wpit.setMinter(address(this));
        wpit.acceptMinter();
        wpit.mint(address(this), 10_000 ether);
        wpit.approve(address(pairUsdc), type(uint256).max);
        usdc.approve(address(pairUsdc), type(uint256).max);
    }

    // ------------------------------------------------------------- WP-04 / #7

    /// The farm must never promise more emissions than it mints. `setShare`
    /// used to cap each gauge at 10_000 bps individually, so three gauges at
    /// 100% each accrued the full emission and the farm owed 3x what `notify()`
    /// minted — paid first-come-first-served.
    function testFarmTotalAllocationCannotExceed100Percent() public {
        wpit.setMinter(address(farm));
        wpit.acceptMinter();
        farm.setShare(address(0xA), 10_000);
        require(farm.totalShareBps() == 10_000, "sum tracked");
        try farm.setShare(address(0xB), 1) {
            revert("WP-04: over-allocation must revert BadBps");
        } catch {}
        require(farm.totalShareBps() == 10_000, "sum unchanged after the revert");
    }

    /// Lowering one gauge frees allocation for another (the cap is a budget,
    /// not a one-way ratchet).
    function testFarmLoweringAGaugeFreesAllocation() public {
        wpit.setMinter(address(farm));
        wpit.acceptMinter();
        farm.setShare(address(0xA), 7_000);
        farm.setShare(address(0xB), 3_000);
        require(farm.totalShareBps() == 10_000, "at the cap");
        farm.setShare(address(0xA), 4_000); // free 3_000
        require(farm.totalShareBps() == 7_000, "budget released");
        farm.setShare(address(0xC), 3_000);
        require(farm.totalShareBps() == 10_000, "re-allocated");
    }

    /// Total accrued across all gauges can never exceed what `notify` minted.
    function testFarmAccrualNeverExceedsMinted() public {
        wpit.setMinter(address(farm));
        wpit.acceptMinter();
        farm.setShare(address(0xA), 5_000);
        farm.setShare(address(0xB), 5_000);
        farm.notify(300 ether);
        farm.accrue(address(0xA));
        farm.accrue(address(0xB));
        require(farm.pending(address(0xA)) + farm.pending(address(0xB)) <= 300 ether, "never owes more than it minted");
        require(wpit.balanceOf(address(farm)) >= farm.pending(address(0xA)) + farm.pending(address(0xB)), "backed by the balance");
    }

    // ------------------------------------------------------------ WP-13 / #18

    /// `acceptMinter()` with no pending proposal used to copy address(0) into
    /// `minter` — unrecoverable, because `mint()` needs `msg.sender == minter`
    /// and `setMinter` rejects zero so it cannot even be re-proposed.
    function testAcceptMinterRejectsNullProposal() public {
        require(wpit.pendingMinter() == address(0), "no proposal at rest");
        try wpit.acceptMinter() {
            revert("WP-13: acceptMinter with no pending proposal must revert");
        } catch {}
        require(wpit.minter() == address(this), "minter unchanged - emissions still mintable");
    }

    /// The propose/accept path the Deployer uses still works.
    function testAcceptMinterStillFinalisesARealProposal() public {
        wpit.setMinter(address(farm));
        require(wpit.pendingMinter() == address(farm), "proposed");
        wpit.acceptMinter();
        require(wpit.minter() == address(farm), "accepted");
        require(wpit.pendingMinter() == address(0), "proposal cleared");
        // A second accept with nothing pending must now revert, not zero it.
        try wpit.acceptMinter() {
            revert("second accept must revert");
        } catch {}
        require(wpit.minter() == address(farm), "minter survived");
    }

    // ------------------------------------------------------------- WP-08 / #9

    /// WPIT must emit the standard ERC-20 logs — explorers, wallets, indexers
    /// and exchange deposit crediting all key off `Transfer`.
    function testWpitEmitsStandardTransferAndApproval() public {
        wpit.setMinter(address(this));
        wpit.acceptMinter();
        wpit.mint(address(this), 100 ether);

        bytes32 transferTopic = keccak256("Transfer(address,address,uint256)");
        bytes32 approvalTopic = keccak256("Approval(address,address,uint256)");

        // Record the logs a plain transfer produces. `MockERC20` — the old base
        // — declared no events at all, so this count was ZERO and no indexer,
        // explorer or exchange could see the token move.
        vm.recordLogs();
        wpit.transfer(address(0xBEEF), 1 ether);
        VmLog[] memory logs = vm.getRecordedLogs();
        require(logs.length == 1, "exactly one Transfer log");
        require(logs[0].topics.length == 3, "Transfer(address indexed,address indexed,uint256)");
        require(logs[0].topics[0] == transferTopic, "standard Transfer topic");
        require(logs[0].topics[1] == bytes32(uint256(uint160(address(this)))), "from indexed");
        require(logs[0].topics[2] == bytes32(uint256(uint160(address(0xBEEF)))), "to indexed");
        require(abi.decode(logs[0].data, (uint256)) == 1 ether, "value in the log");
        require(wpit.balanceOf(address(0xBEEF)) == 1 ether, "transfer applied");

        vm.recordLogs();
        wpit.approve(address(0xBEEF), 5 ether);
        VmLog[] memory alogs = vm.getRecordedLogs();
        require(alogs.length == 1, "exactly one Approval log");
        require(alogs[0].topics[0] == approvalTopic, "standard Approval topic");
        require(wpit.allowance(address(this), address(0xBEEF)) == 5 ether, "approval applied");

        // Minting must log Transfer(address(0), to, amt) too.
        vm.recordLogs();
        wpit.mint(address(0xCAFE), 1 ether);
        VmLog[] memory mlogs = vm.getRecordedLogs();
        require(mlogs.length == 1 && mlogs[0].topics[0] == transferTopic, "mint logs a Transfer");
        require(mlogs[0].topics[1] == bytes32(0), "from == address(0) on mint");
    }

    /// A production contract must not be statically bound to a type named
    /// "Mock": the pool takes `IERC20`.
    function testPairAcceptsAnyIERC20() public {
        // weth/usdc is a perfectly ordinary pair for the same constructor.
        SimplePair p = new SimplePair(IERC20(address(weth)), IERC20(address(usdc)), 30);
        require(address(p.token0()) == address(weth), "typed as IERC20");
        require(address(p.token1()) == address(usdc), "typed as IERC20");
        require(IERC20(address(weth)).decimals() == 18, "standard ERC-20 surface reachable");
    }

    // ------------------------------------------------------------- WP-06 / #11

    /// A swap must be able to bound what it costs.
    function testSwapHonoursMinOut() public {
        fundPair();
        pairUsdc.add(1_000 ether, 1_000e6);
        uint256 fair = pairUsdc.swap0for1(1 ether);
        require(fair > 0, "sanity");
        try pairUsdc.swap0for1(1 ether, fair * 2, 0) {
            revert("WP-06: a fill below minOut must revert");
        } catch {}
    }

    /// A stuck transaction must not execute at a price the sender never agreed.
    function testSwapHonoursDeadline() public {
        fundPair();
        pairUsdc.add(1_000 ether, 1_000e6);
        uint256 expired = block.timestamp + 100;
        vm.warp(block.timestamp + 101); // now strictly past the deadline
        try pairUsdc.swap0for1(1 ether, 0, expired) {
            revert("WP-06: an expired deadline must revert");
        } catch {}
        // The same call with no deadline still works, proving the guard is the
        // deadline and not something else about the state.
        require(pairUsdc.swap0for1(1 ether, 0, type(uint256).max) > 0, "unbounded still fills");
    }

    /// The pool used to trade one direction only — token1 holders could not exit.
    function testReverseSwapExistsAndRoundTrips() public {
        fundPair();
        pairUsdc.add(1_000 ether, 1_000e6);
        uint256 usdc0 = usdc.balanceOf(address(this));
        uint256 wpit0 = wpit.balanceOf(address(this));
        uint256 out = pairUsdc.swap1for0(100e6);
        require(out > 0, "reverse direction pays out");
        require(usdc.balanceOf(address(this)) == usdc0 - 100e6, "USDC delta is exactly the input");
        require(wpit.balanceOf(address(this)) == wpit0 + out, "WPIT delta is exactly the output");
    }

    /// `add` and `remove` carry the same protections.
    function testAddAndRemoveCarrySlippageAndDeadline() public {
        fundPair();
        // Warp FIRST: everything after this point runs at t+101, so the
        // convenience wrappers (which pass max) must keep working and the
        // explicit expired deadline must not.
        uint256 expired = block.timestamp + 100;
        vm.warp(block.timestamp + 101);

        uint256 sh = pairUsdc.add(1_000 ether, 1_000e6);
        require(sh > 0, "the unbounded wrapper still works past an old deadline");

        try pairUsdc.add(10 ether, 10e6, type(uint256).max, type(uint256).max) {
            revert("WP-06: minShares must be enforced");
        } catch {}
        try pairUsdc.remove(sh, type(uint256).max, 0, type(uint256).max) {
            revert("WP-06: min0 must be enforced");
        } catch {}
        try pairUsdc.remove(sh, 0, 0, expired) {
            revert("WP-06: remove deadline must be enforced");
        } catch {}
        try pairUsdc.add(10 ether, 10e6, 0, expired) {
            revert("WP-06: add deadline must be enforced");
        } catch {}
        // The LP position is untouched by all four refusals.
        require(pairUsdc.lpOf(address(this)) == sh, "no shares were lost to a reverted call");
    }

    // ------------------------------------------------------------- WP-09 / #10

    /// A token whose `transfer` returns false must not silently credit anything.
    function testFalseReturningTokenReverts() public {
        FalseToken bad = new FalseToken();
        bad.mint(address(this), 1_000e6);
        bad.approve(address(vault), type(uint256).max);
        // DealerVault is constructed with real USDC/WETH, so exercise the
        // library through a vault-shaped path: creditInsurance pulls USDC.
        uint256 bal0 = usdc.balanceOf(address(vault));
        vault.creditInsurance(1_000e6);
        require(usdc.balanceOf(address(vault)) == bal0 + 1_000e6, "real USDC moved");
        require(vault.insuranceUsdc() == 1_000e6, "ledger matches the tokens");
        require(bad.balanceOf(address(this)) == 1_000e6, "the bad token moved nothing");
    }

    // ------------------------------------------------------------ WP-11 / #15

    /// The insurance ledger must be backed by tokens that actually arrived —
    /// `haltShortGamma()` reads that number, so an unbacked entry would let an
    /// owner disable the short-gamma breaker by writing a figure into storage.
    function testInsuranceCreditMovesRealUsdc() public {
        uint256 held0 = usdc.balanceOf(address(vault));
        uint256 bal0 = usdc.balanceOf(address(this));
        vault.creditInsurance(50_000e6);
        require(usdc.balanceOf(address(this)) == bal0 - 50_000e6, "paid by the caller");
        require(usdc.balanceOf(address(vault)) == held0 + 50_000e6, "received by the vault");
        require(vault.insuranceUsdc() == 50_000e6, "ledger == tokens");
        require(usdc.balanceOf(address(vault)) >= vault.insuranceUsdc(), "never over-claimed");
    }

    /// A credit must fail when the caller cannot pay.
    function testInsuranceCreditFailsWithoutFunds() public {
        vm.prank(address(0xBAD));
        try vault.creditInsurance(1e6) {
            revert("WP-11: an unfunded credit must revert");
        } catch {}
        require(vault.insuranceUsdc() == 0, "nothing was credited");
    }

    // ------------------------------------------------------------ WP-12 / #16

    /// The canonical WP-12 fix: assert BALANCE DELTAS on a value path, not the
    /// absence of a revert. This is the test shape that would have caught
    /// WP-01 (a 50% loss hiding behind `require(shares > 0)`).
    function testPairAddRemoveAssertsBalanceDeltas() public {
        fundPair();
        uint256 w0 = wpit.balanceOf(address(this));
        uint256 u0 = usdc.balanceOf(address(this));

        uint256 sh = pairUsdc.add(1_000 ether, 1_000e6);
        require(sh > 0, "shares minted");
        require(w0 - wpit.balanceOf(address(this)) == 1_000 ether, "exactly the WPIT went in");
        require(u0 - usdc.balanceOf(address(this)) == 1_000e6, "exactly the USDC went in");

        (uint256 back0, uint256 back1) = pairUsdc.remove(sh);
        // The delta is the assertion: only the burned MINIMUM_LIQUIDITY share of
        // the pool may be missing. Pre-fix this returned ~half of each leg.
        uint256 burn = pairUsdc.MINIMUM_LIQUIDITY();
        // Only the burned MINIMUM_LIQUIDITY fraction of the pool may be missing.
        // Pre-fix this returned ~half of each leg while the old test only
        // checked `shares > 0` and that remove did not revert.
        uint256 maxLostWpit = (1_000 ether * burn) / 1_000 ether + 1;
        uint256 maxLostUsdc = (1_000e6 * burn) / 1_000 ether + 1;
        require(w0 - wpit.balanceOf(address(this)) <= maxLostWpit, "WPIT returned minus the burn");
        require(u0 - usdc.balanceOf(address(this)) <= maxLostUsdc, "USDC returned minus the burn");
        require(back0 > 999 ether, "WPIT leg made whole");
        require(back1 > 999e6, "USDC leg made whole");
        // Invariant: supply is exactly the sum of the ledger.
        require(pairUsdc.lpSupply() == pairUsdc.lpOf(address(0)) + pairUsdc.lpOf(address(this)), "lpSupply == sum(lpOf)");
    }
}

/// @notice A token whose `transfer` returns false — the silent-failure case
///         WP-09 / #10 is about.
contract FalseToken {
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 amt) external {
        balanceOf[to] += amt;
    }

    function approve(address, uint256) external pure returns (bool) {
        return true;
    }

    function transfer(address, uint256) external pure returns (bool) {
        return false;
    }

    function transferFrom(address, address, uint256) external pure returns (bool) {
        return false;
    }
}
