// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {WPIT} from "./WPIT.sol";
import {DealerVault} from "./DealerVault.sol";

/// @notice Gauge weights 70 / 20 / 10. Harvest tax 1% → insurance.
///         Not deployed at Base launch (no WPIT) — kept for the token era.
///
///         Accrual is CHECKPOINTED: `totalAcc` grows on every `notify`; each
///         user's share is snapshotted via `setShare`/`accrue`, and their
///         `pending` is credited for (totalAcc − accBase) × bps. Re-accruing
///         can never double-pay. `shareBps` is capped at 10_000 and only the
///         owner (a keeper/multisig reading its own share accounting) may set
///         it — never a user-supplied value. The util factor comes from the
///         vault itself (`vault.utilBps()`), never from a caller.
contract Farm {
    WPIT public immutable wpit;
    DealerVault public immutable vault;
    address public owner;

    /// @notice Total emissions accrued into the pool (divides per user).
    uint256 public totalAcc;
    /// @notice Display splits (70/20/10 of `totalAcc` after the util factor).
    uint256 public accVault;
    uint256 public accUsdc;
    uint256 public accEth;

    mapping(address => uint256) public pending;
    mapping(address => uint256) public shareBps;
    /// @notice `totalAcc` value the user's `shareBps` was last settled at.
    mapping(address => uint256) public accBase;

    error NotOwner();
    error BadBps();

    event OwnerSet(address indexed previous, address indexed next);
    event ShareSet(address indexed user, uint256 bps);
    event Accrued(address indexed user, uint256 due);

    constructor(WPIT wpit_, DealerVault vault_) {
        wpit = wpit_;
        vault = vault_;
        owner = msg.sender;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function setOwner(address next) external onlyOwner {
        emit OwnerSet(owner, next);
        owner = next;
    }

    /// @notice Util-weighted emit: 70% of `amt` scaled by the vault util factor
    ///         (30% floor + 70%·util) goes to the vault gauge; 20/10 split the
    ///         rest for the two WPIT pools. Util is read from the vault.
    function notify(uint256 amt) external onlyOwner {
        if (amt == 0) return;
        uint256 u = vault.utilBps(); // 0..10_000
        uint256 utilFactor = 3_000 + (7_000 * u) / 10_000;
        uint256 toVault = (amt * 7_000 * utilFactor) / (10_000 * 10_000);
        uint256 rest = amt - toVault;
        accVault += toVault;
        accUsdc += (rest * 2) / 3;
        accEth += rest - (rest * 2) / 3;
        totalAcc += amt;
        wpit.mint(address(this), amt);
    }

    /// @notice Set a user's gauge share (bps of the accrual pool). Settles the
    ///         previous share first, so changing a share can never pay twice.
    function setShare(address user, uint256 bps) external onlyOwner {
        if (bps > 10_000) revert BadBps();
        _checkpoint(user);
        shareBps[user] = bps;
        emit ShareSet(user, bps);
    }

    /// @notice Owner (keeper) settles a user's slice. `shareBps` must come from
    ///         the keeper's own share accounting (see `setShare`), never a user.
    function accrue(address user) external onlyOwner {
        _checkpoint(user);
    }

    function _checkpoint(address user) internal {
        uint256 span = totalAcc - accBase[user];
        uint256 due = (span * shareBps[user]) / 10_000;
        accBase[user] = totalAcc;
        if (due > 0) {
            pending[user] += due;
            emit Accrued(user, due);
        }
    }

    function harvest() external returns (uint256 net, uint256 tax) {
        uint256 due = pending[msg.sender];
        pending[msg.sender] = 0;
        tax = due / 100;
        net = due - tax;
        if (tax > 0) {
            wpit.transfer(address(vault), tax);
            vault.creditInsuranceWpit(tax);
        }
        if (net > 0) wpit.transfer(msg.sender, net);
    }
}
