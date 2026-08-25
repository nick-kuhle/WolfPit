// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {WPIT} from "./WPIT.sol";
import {DealerVault} from "./DealerVault.sol";

/// @notice Gauge weights 70 / 20 / 10. Harvest tax 1% → insurance.
contract Farm {
    WPIT public immutable wpit;
    DealerVault public immutable vault;
    uint256 public accVault;
    uint256 public accUsdc;
    uint256 public accEth;
    mapping(address => uint256) public pending;

    constructor(WPIT wpit_, DealerVault vault_) {
        wpit = wpit_;
        vault = vault_;
    }

    /// @notice util-weighted emit. `amt` minted to this farm, split 70/20/10 * util factor on vault slice.
    function notify(uint256 amt, uint256 utilBps) external {
        uint256 u = 3_000 + (7_000 * utilBps) / 10_000;
        uint256 toVault = (amt * 7_000 * u) / (10_000 * 10_000);
        uint256 rest = amt - toVault;
        accVault += toVault;
        accUsdc += (rest * 2) / 3;
        accEth += rest - (rest * 2) / 3;
        wpit.mint(address(this), amt);
    }

    function accrue(address user, uint256 shareBps) external {
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
