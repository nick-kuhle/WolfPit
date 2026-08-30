// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockERC20} from "./mocks/MockERC20.sol";

/// @notice Constant-product TEST pool. Not Uni v4.
///
///         TEST only — but kept theft-resistant: shares are priced on the
///         SMALLER of the two legs (`min(a0·L/r0, a1·L/r1)`), so an imbalanced
///         add cannot mint shares off one leg and redeem them off both. First
///         deposit burns MINIMUM_LIQUIDITY to address(0) so the pool can never
///         be fully drained and re-created at an attacker's price. Fee is
///         owner-only.
contract SimplePair {
    MockERC20 public immutable token0;
    MockERC20 public immutable token1;
    address public owner;
    uint256 public reserve0;
    uint256 public reserve1;
    uint256 public lpSupply;
    uint256 public feeBps;
    mapping(address => uint256) public lpOf;

    /// @notice Shares burned to address(0) on the first add (Uniswap V2
    ///         MINIMUM_LIQUIDITY pattern): at least this much stays locked.
    uint256 public constant MINIMUM_LIQUIDITY = 1_000;

    error Zero();
    error Fee();
    error NotOwner();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(MockERC20 t0, MockERC20 t1, uint256 feeBps_) {
        token0 = t0;
        token1 = t1;
        feeBps = feeBps_;
        owner = msg.sender;
    }

    function setFeeBps(uint256 bps) external onlyOwner {
        if (bps < 5 || bps > 30) revert Fee();
        feeBps = bps;
    }

    function add(uint256 a0, uint256 a1) external returns (uint256 shares) {
        if (a0 == 0 || a1 == 0) revert Zero();
        token0.transferFrom(msg.sender, address(this), a0);
        token1.transferFrom(msg.sender, address(this), a1);
        if (lpSupply == 0) {
            if (a0 < MINIMUM_LIQUIDITY || a1 < MINIMUM_LIQUIDITY) revert Zero();
            shares = a0 - MINIMUM_LIQUIDITY;
            lpSupply = a0;
            lpOf[address(0)] += MINIMUM_LIQUIDITY; // burned, never redeemable
        } else {
            // Fair shares: priced on the SMALLER proportional leg, so neither
            // side of the deposit can be over-credited.
            uint256 s0 = (a0 * lpSupply) / reserve0;
            uint256 s1 = (a1 * lpSupply) / reserve1;
            shares = s0 < s1 ? s0 : s1;
        }
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
