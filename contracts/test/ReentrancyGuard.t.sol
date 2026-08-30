// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Regression test for the reentrancy sweep (work-order A1): an allowlisted
// router's swap callback MUST NOT be able to re-enter the vault's risk or
// share functions. The original finding (PoC) showed a router re-entering
// `deposit()` mid-`openShort` and inflating `usdcBal` by the deposit amount —
// this test pins the fix (nonReentrant on deposit + slashInsuranceJunior).
import {DealerVault, IERC20, IOracle} from "../src/DealerVault.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {MockOracle} from "../src/mocks/MockOracle.sol";

interface Vm {
    function startPrank(address) external;
    function stopPrank() external;
}

/// @notice Malicious allowlisted router: pulls WETH (the "swap"), attempts to
///         re-enter deposit / writeCall / openLong from inside the callback,
///         then pays USDC swap proceeds. Records what it managed to get into.
contract ReentrantRouter {
    MockERC20 public immutable weth;
    MockERC20 public immutable usdc;
    DealerVault public immutable vault;

    bool public depositReentered;
    bool public writeCallReentered;
    bool public openLongReentered;
    bytes4 public depositRevert; // selector the vault reverted with (0 = never reverted)

    constructor(MockERC20 w, MockERC20 u, DealerVault v) {
        weth = w;
        usdc = u;
        vault = v;
    }

    /// `data` target for vault.openShort(...). "Pays" the swap after probing.
    function pwn(uint256 size, uint256 minOut) external {
        weth.transferFrom(address(vault), address(this), size);

        // Re-entry 1: mint shares mid-swap (the ledger-corruption vector).
        usdc.approve(address(vault), 1_000e6);
        try vault.deposit(0, 1_000e6) {
            depositReentered = true;
        } catch (bytes memory why) {
            depositRevert = _selector(why);
        }

        // Re-entry 2 + 3: risk accounting must also refuse mid-swap.
        try vault.writeCall(0.1 ether) {
            writeCallReentered = true;
        } catch {}
        try vault.openLong(0.1 ether) {
            openLongReentered = true;
        } catch {}

        // Swap proceeds leg (the honest part of the router).
        usdc.transfer(address(vault), minOut);
    }

    function _selector(bytes memory data) internal pure returns (bytes4 s) {
        if (data.length < 4) return bytes4(0);
        assembly {
            s := mload(add(data, 32))
        }
    }
}

/// @notice Malicious stake: `slash` re-enters vault.deposit() mid-slash
///         (deposit has no access control — the ONLY thing standing in its way
///         is the nonReentrant guard). If the guard is missing this call
///         SUCCEEDS (the exploit); when the guard is present it reverts with
///         Reentrant and we re-bubble so the whole slash reverts fail-closed.
contract MaliciousStake {
    DealerVault public immutable vault;
    MockERC20 public immutable usdc;
    bool public reentered;

    constructor(DealerVault v, MockERC20 u) {
        vault = v;
        usdc = u;
    }

    /// Test funds the probe before the slash (mock mint is unrestricted).
    function fundProbe() external {
        usdc.mint(address(this), 100_000e6);
        usdc.approve(address(vault), 100_000e6);
    }

    function slash(uint256 amt) external returns (uint256) {
        try vault.deposit(0, 1_000e6) {
            reentered = true;
        } catch (bytes memory why) {
            _bubble(why);
        }
        return amt;
    }

    function _bubble(bytes memory data) internal pure {
        assembly {
            revert(add(data, 32), mload(data))
        }
    }
}

contract ReentrancyGuardTest {
    Vm constant vm = Vm(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);
    MockERC20 usdc;
    MockERC20 weth;
    MockOracle oracle;
    DealerVault vault;
    address constant OPERATOR = address(0xB0B);

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        weth = new MockERC20("Wrapped Ether", "WETH", 18);
        oracle = new MockOracle(4_000e6);
        vault = new DealerVault(
            IERC20(address(usdc)), IERC20(address(weth)), IOracle(address(oracle)), address(this), OPERATOR
        );
        usdc.mint(address(this), 2_000_000e6);
        weth.mint(address(this), 200 ether);
        usdc.approve(address(vault), type(uint256).max);
        weth.approve(address(vault), type(uint256).max);
        vault.deposit(100 ether, 400_000e6);
        vault.creditInsurance(20_000e6); // unblock short gamma for the probes
    }

    function _allowlist(address router) internal {
        vm.startPrank(address(this));
        vault.allowTarget(router, true);
        vault.setAllowance(IERC20(address(weth)), router, 100 ether);
        vm.stopPrank();
    }

    function testRouterCannotReenterDuringOpenShort() public {
        ReentrantRouter router = new ReentrantRouter(weth, usdc, vault);
        usdc.mint(address(router), 1_000_000e6);
        _allowlist(address(router));

        uint256 size = 10 ether;
        uint256 minOut = 39_000e6;
        vm.startPrank(OPERATOR);
        vault.openShort(size, address(router), abi.encodeCall(ReentrantRouter.pwn, (size, minOut)), minOut);
        vm.stopPrank();

        // Every re-entry attempt was refused with the vault's own Reentrant().
        require(!router.depositReentered(), "deposit re-entered the vault");
        require(router.depositRevert() == DealerVault.Reentrant.selector, "deposit did not revert Reentrant");
        require(!router.writeCallReentered(), "writeCall re-entered the vault");
        require(!router.openLongReentered(), "openLong re-entered the vault");

        // And the ledger matches the real balances exactly (no inflation).
        require(vault.usdcBal() == usdc.balanceOf(address(vault)), "usdcBal drifted from real balance");
        require(vault.ethBal() == weth.balanceOf(address(vault)), "ethBal drifted from real balance");
    }

    function testSlashInsuranceJuniorBlocksReentrantStake() public {
        MaliciousStake stake = new MaliciousStake(vault, usdc);
        stake.fundProbe();
        vm.startPrank(address(this));
        vault.setStake(address(stake));
        vm.stopPrank();

        try vault.slashInsuranceJunior(1e18) {
            revert("slashInsuranceJunior should have reverted on malicious stake");
        } catch (bytes memory why) {
            bytes4 sel;
            assembly {
                sel := mload(add(why, 32))
            }
            require(sel == DealerVault.Reentrant.selector, "expected Reentrant from malicious stake");
        }
        require(!stake.reentered(), "stake reached vault accounting mid-slash");
        require(vault.insuranceWpit() == 0, "slash must not credit anything after a reverted re-entry");
    }

    function testDepositStillWorksAfterGuard() public {
        // Sanity: the guard must not break honest deposits.
        vault.deposit(1 ether, 4_000e6);
        require(vault.ethBal() == 101 ether, "eth deposit blocked");
        require(vault.usdcBal() == 404_000e6, "usdc deposit blocked");
    }
}
