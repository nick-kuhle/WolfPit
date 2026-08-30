// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Test/staging oracle with a settable price.
contract MockOracle {
    uint256 public px;

    constructor(uint256 p) {
        px = p;
    }

    function set(uint256 p) external {
        px = p;
    }

    function ethUsdc() external view returns (uint256) {
        return px;
    }
}
