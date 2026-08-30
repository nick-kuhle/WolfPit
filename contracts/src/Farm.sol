// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {WPIT} from "./WPIT.sol";
import {DealerVault} from "./DealerVault.sol";

/// @notice Gauge weights 70 / 20 / 10. Harvest tax 1% → insurance.
///         Not deployed at Base launch (no WPIT) — kept for the token era.
///         Auth: owner (multisig/keeper) is the only notifier/accruer; a live
///         gauge must track LP shares itself, never trust caller-supplied
///         shareBps for arbitrary users.
contract Farm {
    WPIT public immutable wpit;
    DealerVault public immutable vault;
    address public owner;
    uint256 public accVault;
    uint256 public accUsdc;
    uint256 public accEth;
    mapping(address => uint256) public pending;

    error NotOwner();

    event OwnerSet(address indexed previous, address indexed next);

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

    /// @notice util-weighted emit. `amt` minted to this farm, split 70/20/10 * util factor on vault slice.
    function notify(uint256 amt, uint256 utilBps) external onlyOwner {
        uint256 u = 3_000 + (7_000 * utilBps) / 10_000;
        uint256 toVault = (amt * 7_000 * u) / (10_000 * 10_000);
        uint256 rest = amt - toVault;
        accVault += toVault;
        accUsdc += (rest * 2) / 3;
        accEth += rest - (rest * 2) / 3;
        wpit.mint(address(this), amt);
    }

    /// @notice Owner (keeper) accrues a user's slice. shareBps must come from
    ///         the keeper's own share accounting, not from the user.
    function accrue(address user, uint256 shareBps) external onlyOwner {
        pending[user] += (accVault + accUsdc + accEth) * shareBps / 10_000;
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
