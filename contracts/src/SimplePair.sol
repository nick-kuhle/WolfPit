// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockERC20} from "./mocks/MockERC20.sol";

/// @notice Constant-product TEST pool. Not Uni v4.
contract SimplePair {
    MockERC20 public immutable token0;
    MockERC20 public immutable token1;
    uint256 public reserve0;
    uint256 public reserve1;
    uint256 public lpSupply;
    uint256 public feeBps;
    mapping(address => uint256) public lpOf;

    error Zero();

    constructor(MockERC20 t0, MockERC20 t1, uint256 feeBps_) {
        token0 = t0;
        token1 = t1;
        feeBps = feeBps_;
    }

    function setFeeBps(uint256 bps) external {
        require(bps >= 5 && bps <= 30, "fee");
        feeBps = bps;
    }

    function add(uint256 a0, uint256 a1) external returns (uint256 shares) {
        if (a0 == 0 || a1 == 0) revert Zero();
        token0.transferFrom(msg.sender, address(this), a0);
        token1.transferFrom(msg.sender, address(this), a1);
        if (lpSupply == 0) shares = a0;
        else shares = (a0 * lpSupply) / reserve0;
        reserve0 += a0;
        reserve1 += a1;
        lpSupply += shares;
        lpOf[msg.sender] += shares;
    }

    function remove(uint256 shares) external returns (uint256 a0, uint256 a1) {
        if (shares == 0 || shares > lpOf[msg.sender]) revert Zero();
        a0 = (shares * reserve0) / lpSupply;
        a1 = (shares * reserve1) / lpSupply;
        lpOf[msg.sender] -= shares;
        lpSupply -= shares;
        reserve0 -= a0;
        reserve1 -= a1;
        token0.transfer(msg.sender, a0);
        token1.transfer(msg.sender, a1);
    }

    function swap0for1(uint256 amtIn) external returns (uint256 out) {
        if (amtIn == 0) revert Zero();
        token0.transferFrom(msg.sender, address(this), amtIn);
        uint256 inWfee = amtIn * (10_000 - feeBps);
        out = (inWfee * reserve1) / (reserve0 * 10_000 + inWfee);
        reserve0 += amtIn;
        reserve1 -= out;
        token1.transfer(msg.sender, out);
    }
}
