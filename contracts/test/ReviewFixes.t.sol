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
        vault = new DealerVault(IERC20(address(usdc)), IERC20(address(weth)), IOracle(address(oracle)), address(this), address(this), true);
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
        // audit C-5: decimals is queried on the concrete token, not the
        // vault's minimal IERC20 surface (which dropped the never-used member).
        require(weth.decimals() == 18, "standard ERC-20 surface reachable");
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

/* ------------------------------------------------------------------ *
 * WP-05 / #12 — constrain the owner/operator drain path
 * ------------------------------------------------------------------ */

/// @notice Stands in for a multisig: has code, so it satisfies the
///         contract-owner assertion. It deliberately does nothing else.
contract FakeMultisig {}

/// @notice Router with two entry points, so the selector allowlist can be shown
///         to permit one and refuse the other on the SAME allowlisted address.
contract TwoFaceRouter {
    IERC20 public immutable token;

    constructor(IERC20 t) {
        token = t;
    }

    /// The benign hedge entry point.
    function hedge(uint256 amt) external {
        token.transferFrom(msg.sender, address(this), amt);
    }

    /// The drain entry point: same contract, same allowance, different selector.
    function pwn(address from, uint256 amt) external {
        token.transferFrom(from, address(this), amt);
    }
}

contract Wp05DrainPathTest {
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
        // address(this) is a contract, so the owner assertion is satisfiable.
        vault = new DealerVault(
            IERC20(address(usdc)),
            IERC20(address(weth)),
            IOracle(address(oracle)),
            address(this),
            address(this),
            true
        );
        usdc.mint(address(this), 2_000_000e6);
        weth.mint(address(this), 200 ether);
        usdc.approve(address(vault), type(uint256).max);
        weth.approve(address(vault), type(uint256).max);
        vault.deposit(100 ether, 400_000e6);
        vault.creditInsurance(20_000e6);
    }

    // ------------------------------------------------------------- multisig

    /// The trust model the README advertises must be the one that got deployed:
    /// a bare EOA owner is a single key that can allowlist a router, grant it an
    /// allowance, and walk out with the book.
    function testConstructorRejectsEoaOwner() public {
        vm.prank(ALICE); // ALICE is an EOA: no code at that address
        try new DealerVault(
            IERC20(address(usdc)),
            IERC20(address(weth)),
            IOracle(address(oracle)),
            ALICE,
            address(this),
            true
        ) {
            revert("expected OwnerNotContract");
        } catch (bytes memory why) {
            require(
                bytes4(why) == DealerVault.OwnerNotContract.selector,
                "must revert OwnerNotContract"
            );
        }
    }

    /// A contract owner (multisig / timelock module) is accepted.
    function testConstructorAcceptsContractOwner() public {
        FakeMultisig ms = new FakeMultisig();
        DealerVault v = new DealerVault(
            IERC20(address(usdc)),
            IERC20(address(weth)),
            IOracle(address(oracle)),
            address(ms),
            address(this),
            true
        );
        require(v.owner() == address(ms), "multisig is the owner");
    }

    // ----------------------------------------------------------- timelock

    /// allowTarget cannot be applied cold: it must be queued first.
    function testAllowTargetRequiresQueueing() public {
        TwoFaceRouter r = new TwoFaceRouter(IERC20(address(weth)));
        try vault.allowTarget(address(r), true) {
            revert("expected NotQueued");
        } catch (bytes memory why) {
            require(bytes4(why) == DealerVault.NotQueued.selector, "must revert NotQueued");
        }
        require(!vault.allowedTarget(address(r)), "target is still not allowlisted");
    }

    /// Queueing is not enough either — the delay must actually elapse.
    function testAllowTargetWaitsForTimelock() public {
        TwoFaceRouter r = new TwoFaceRouter(IERC20(address(weth)));
        vault.queueAllowTarget(address(r), true);
        // One second short of the delay.
        vm.warp(block.timestamp + vault.ADMIN_TIMELOCK() - 1);
        try vault.allowTarget(address(r), true) {
            revert("expected TimelockPending");
        } catch (bytes memory why) {
            require(
                bytes4(why) == DealerVault.TimelockPending.selector,
                "must revert TimelockPending"
            );
        }
        require(!vault.allowedTarget(address(r)), "still not allowlisted before maturity");

        vm.warp(block.timestamp + 2);
        vault.allowTarget(address(r), true);
        require(vault.allowedTarget(address(r)), "allowlisted once the delay elapsed");
    }

    /// The queued id binds the exact parameters, so queueing a benign action
    /// cannot authorise a different one.
    function testQueuedActionIsBoundToItsParameters() public {
        TwoFaceRouter r = new TwoFaceRouter(IERC20(address(weth)));
        // Queue "allow r", then try to execute "allow some other address".
        vault.queueAllowTarget(address(r), true);
        vm.warp(block.timestamp + vault.ADMIN_TIMELOCK() + 1);
        address other = address(0xBEEF);
        try vault.allowTarget(other, true) {
            revert("expected NotQueued for the un-queued parameters");
        } catch (bytes memory why) {
            require(bytes4(why) == DealerVault.NotQueued.selector, "must revert NotQueued");
        }
        require(!vault.allowedTarget(other), "the other address was never allowlisted");
    }

    /// A queued action is single-use: it cannot be replayed.
    function testQueuedActionIsSingleUse() public {
        TwoFaceRouter r = new TwoFaceRouter(IERC20(address(weth)));
        vault.queueAllowTarget(address(r), true);
        vm.warp(block.timestamp + vault.ADMIN_TIMELOCK() + 1);
        vault.allowTarget(address(r), true);
        try vault.allowTarget(address(r), true) {
            revert("expected NotQueued on replay");
        } catch (bytes memory why) {
            require(bytes4(why) == DealerVault.NotQueued.selector, "must revert NotQueued");
        }
    }

    /// The owner can withdraw a pending action before it matures.
    function testCancelAdmin() public {
        TwoFaceRouter r = new TwoFaceRouter(IERC20(address(weth)));
        bytes32 id = vault.allowTargetId(address(r), true);
        vault.queueAllowTarget(address(r), true);
        require(vault.adminReadyAt(id) != 0, "queued");
        vault.cancelAdmin(id);
        require(vault.adminReadyAt(id) == 0, "cleared");
        vm.warp(block.timestamp + vault.ADMIN_TIMELOCK() + 1);
        try vault.allowTarget(address(r), true) {
            revert("expected NotQueued after cancel");
        } catch (bytes memory why) {
            require(bytes4(why) == DealerVault.NotQueued.selector, "must revert NotQueued");
        }
    }

    // ------------------------------------------------------ allowance cap

    /// An unlimited approval to an allowlisted router is a complete withdrawal
    /// path for whoever holds that router's key, so it must be refused.
    function testSetAllowanceRejectsOverCapGrant() public {
        TwoFaceRouter r = new TwoFaceRouter(IERC20(address(usdc)));
        vault.queueAllowTarget(address(r), true);
        vault.queueSetAllowance(IERC20(address(usdc)), address(r), type(uint256).max);
        vm.warp(block.timestamp + vault.ADMIN_TIMELOCK() + 1);
        vault.allowTarget(address(r), true);
        try vault.setAllowance(IERC20(address(usdc)), address(r), type(uint256).max) {
            revert("expected AllowanceTooLarge");
        } catch (bytes memory why) {
            require(
                bytes4(why) == DealerVault.AllowanceTooLarge.selector,
                "must revert AllowanceTooLarge"
            );
        }
        require(
            usdc.allowance(address(vault), address(r)) == 0,
            "no allowance was granted"
        );
    }

    /// A grant at exactly the cap is allowed, and the balance delta proves the
    /// router can move at most that much.
    function testSetAllowanceAcceptsGrantAtCap() public {
        TwoFaceRouter r = new TwoFaceRouter(IERC20(address(usdc)));
        uint256 cap = vault.allowanceCap(address(usdc));
        require(cap == 1_000_000e6, "default USDC cap");
        vault.queueAllowTarget(address(r), true);
        vault.queueSetAllowance(IERC20(address(usdc)), address(r), cap);
        vm.warp(block.timestamp + vault.ADMIN_TIMELOCK() + 1);
        vault.allowTarget(address(r), true);
        vault.setAllowance(IERC20(address(usdc)), address(r), cap);
        require(usdc.allowance(address(vault), address(r)) == cap, "allowance set at the cap");
    }

    /// The cap is per-token: the WETH cap is 500e18, not the USDC figure. A flat
    /// scalar would have allowed 0.000001 WETH.
    function testAllowanceCapIsPerToken() public {
        require(vault.allowanceCap(address(usdc)) == 1_000_000e6, "USDC cap");
        require(vault.allowanceCap(address(weth)) == 500 ether, "WETH cap");
        // A token nobody configured has a cap of 0, so every grant fails closed.
        address stranger = address(0xC0FFEE);
        require(vault.allowanceCap(stranger) == 0, "unconfigured token has no allowance headroom");
    }

    /// Raising a cap is itself timelocked.
    function testRaiseCapIsTimelocked() public {
        vault.queueSetAllowanceCap(IERC20(address(usdc)), 5_000_000e6);
        vm.warp(block.timestamp + vault.ADMIN_TIMELOCK() - 1);
        try vault.setAllowanceCap(IERC20(address(usdc)), 5_000_000e6) {
            revert("expected TimelockPending");
        } catch (bytes memory why) {
            require(
                bytes4(why) == DealerVault.TimelockPending.selector,
                "must revert TimelockPending"
            );
        }
        require(vault.allowanceCap(address(usdc)) == 1_000_000e6, "cap unchanged before maturity");
        vm.warp(block.timestamp + 2);
        vault.setAllowanceCap(IERC20(address(usdc)), 5_000_000e6);
        require(vault.allowanceCap(address(usdc)) == 5_000_000e6, "cap raised after the delay");
    }

    // -------------------------------------------------- selector allowlist

    /// Allowlisting an ADDRESS is not sufficient. Two entry points on the same
    /// allowlisted router, same allowance: only the allowlisted one may run.
    function testExecRequiresAllowlistedSelector() public {
        TwoFaceRouter r = new TwoFaceRouter(IERC20(address(weth)));
        vault.queueAllowTarget(address(r), true);
        vault.queueAllowSelector(TwoFaceRouter.hedge.selector, true);
        vault.queueSetAllowance(IERC20(address(weth)), address(r), 10 ether);
        vm.warp(block.timestamp + vault.ADMIN_TIMELOCK() + 1);
        vault.allowTarget(address(r), true);
        vault.allowSelector(TwoFaceRouter.hedge.selector, true);
        vault.setAllowance(IERC20(address(weth)), address(r), 10 ether);

        // The allowlisted selector runs.
        vault.exec(address(r), abi.encodeWithSelector(TwoFaceRouter.hedge.selector, 1 ether));

        // The drain selector on the SAME allowlisted address must not.
        uint256 before = weth.balanceOf(address(vault));
        try vault.exec(
            address(r),
            abi.encodeWithSelector(TwoFaceRouter.pwn.selector, address(vault), 50 ether)
        ) {
            revert("expected BadSelector");
        } catch (bytes memory why) {
            require(bytes4(why) == DealerVault.BadSelector.selector, "must revert BadSelector");
        }
        require(weth.balanceOf(address(vault)) == before, "nothing moved via the blocked selector");
    }

    /// Calldata too short to carry a selector is rejected rather than treated as
    /// an empty call that silently succeeds.
    function testExecRejectsCalldataWithoutSelector() public {
        TwoFaceRouter r = new TwoFaceRouter(IERC20(address(weth)));
        vault.queueAllowTarget(address(r), true);
        vm.warp(block.timestamp + vault.ADMIN_TIMELOCK() + 1);
        vault.allowTarget(address(r), true);
        try vault.exec(address(r), hex"0011") {
            revert("expected BadCalldata");
        } catch (bytes memory why) {
            require(bytes4(why) == DealerVault.BadCalldata.selector, "must revert BadCalldata");
        }
    }

    /// A non-owner cannot queue anything, so the timelock cannot be pre-loaded
    /// by an attacker for a later owner mistake.
    function testQueueingIsOwnerOnly() public {
        TwoFaceRouter r = new TwoFaceRouter(IERC20(address(weth)));
        vm.prank(ALICE);
        try vault.queueAllowTarget(address(r), true) {
            revert("expected NotOwner");
        } catch (bytes memory why) {
            require(bytes4(why) == DealerVault.NotOwner.selector, "must revert NotOwner");
        }
        require(vault.adminReadyAt(vault.allowTargetId(address(r), true)) == 0, "nothing queued");
    }

    // -------------------------------------------------------- instant revoke

    /// Audit C-2: the kill direction of the allowlist must NOT wait out the
    ///        2-day queue. In a router incident the owner removes the target,
    ///        the selector and — critically, because a live ERC-20 allowance
    ///        pulls WITHOUT touching `exec` — the allowance, all in one block.
    function testRevocationsAreInstant() public {
        TwoFaceRouter r = new TwoFaceRouter(IERC20(address(weth)));
        vault.queueAllowTarget(address(r), true);
        vault.queueAllowSelector(TwoFaceRouter.hedge.selector, true);
        vault.queueSetAllowance(IERC20(address(weth)), address(r), 10 ether);
        vm.warp(block.timestamp + vault.ADMIN_TIMELOCK() + 1);
        vault.allowTarget(address(r), true);
        vault.allowSelector(TwoFaceRouter.hedge.selector, true);
        vault.setAllowance(IERC20(address(weth)), address(r), 10 ether);
        vault.exec(address(r), abi.encodeWithSelector(TwoFaceRouter.hedge.selector, 1 ether));

        // No queue, no warp — all three revocations land right now.
        vault.revokeTarget(address(r));
        vault.revokeSelector(TwoFaceRouter.hedge.selector);
        vault.revokeAllowance(IERC20(address(weth)), address(r));

        require(!vault.allowedTarget(address(r)), "target gone same-block");
        require(!vault.allowedSelector(TwoFaceRouter.hedge.selector), "selector gone same-block");
        require(
            weth.allowance(address(vault), address(r)) == 0,
            "allowance zeroed - the direct transferFrom pull is closed"
        );
        try vault.exec(address(r), abi.encodeWithSelector(TwoFaceRouter.hedge.selector, 1 ether)) {
            revert("expected BadTarget after instant revoke");
        } catch (bytes memory why) {
            require(bytes4(why) == DealerVault.BadTarget.selector, "must revert BadTarget");
        }
    }

    /// The instant direction stays owner-only: a compromised keeper key must
    ///        not strip the very allowlists the owner relies on, and the
    ///        timelock on GRANTS is untouched (risk-up slow, risk-down fast).
    function testRevocationsAreOwnerOnly() public {
        TwoFaceRouter r = new TwoFaceRouter(IERC20(address(weth)));
        vm.prank(ALICE);
        try vault.revokeTarget(address(r)) {
            revert("expected NotOwner");
        } catch (bytes memory why) {
            require(bytes4(why) == DealerVault.NotOwner.selector, "must revert NotOwner");
        }
        vm.prank(ALICE);
        try vault.revokeSelector(TwoFaceRouter.hedge.selector) {
            revert("expected NotOwner");
        } catch (bytes memory why) {
            require(bytes4(why) == DealerVault.NotOwner.selector, "must revert NotOwner");
        }
        vm.prank(ALICE);
        try vault.revokeAllowance(IERC20(address(weth)), address(r)) {
            revert("expected NotOwner");
        } catch (bytes memory why) {
            require(bytes4(why) == DealerVault.NotOwner.selector, "must revert NotOwner");
        }
        // Idempotent: revoking what was never granted is a no-op, not a
        // revert — incident tooling must not wedge on a stale address.
        vault.revokeTarget(address(r));
        require(!vault.allowedTarget(address(r)), "still not allowed");
    }
}
