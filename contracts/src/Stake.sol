// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {WPIT} from "./WPIT.sol";
import {DealerVault} from "./DealerVault.sol";

/// @notice First-loss junior. Slash order: insurance USDC → staked WPIT → pause → LP NAV.
contract Stake {
    WPIT public immutable wpit;
    DealerVault public immutable vault;
    mapping(address => uint256) public staked;
    uint256 public total;

    constructor(WPIT wpit_, DealerVault vault_) {
        wpit = wpit_;
        vault = vault_;
    }

    function stake(uint256 amt) external {
        wpit.transferFrom(msg.sender, address(this), amt);
        staked[msg.sender] += amt;
        total += amt;
    }

    function unstake(uint256 amt) external {
        require(staked[msg.sender] >= amt, "bal");
        staked[msg.sender] -= amt;
        total -= amt;
        wpit.transfer(msg.sender, amt);
    }

    function slash(uint256 amt) external {
        require(msg.sender == address(vault), "vault");
        if (amt > total) amt = total;
        total -= amt;
        wpit.transfer(address(vault), amt);
    }
}
