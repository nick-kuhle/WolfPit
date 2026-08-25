// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockERC20} from "./mocks/MockERC20.sol";

/// @notice WPIT-TEST. Cap. Not an offering.
contract WPIT is MockERC20 {
    uint256 public immutable cap;
    address public minter;

    error Cap();
    error Minter();

    constructor(uint256 cap_) MockERC20("WolfPit TEST", "WPIT-TEST", 18) {
        cap = cap_;
        minter = msg.sender;
    }

    function setMinter(address m) external {
        if (msg.sender != minter) revert Minter();
        minter = m;
    }

    function mint(address to, uint256 amt) external override {
        if (msg.sender != minter) revert Minter();
        if (totalSupply + amt > cap) revert Cap();
        totalSupply += amt;
        balanceOf[to] += amt;
    }
}
