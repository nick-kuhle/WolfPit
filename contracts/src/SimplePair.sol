// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./DealerVault.sol";
import {SafeERC20} from "./SafeERC20.sol";

/// @notice Constant-product TEST pool. Not Uni v4.
///
///         TEST only — but kept theft-resistant: shares are priced on the
///         SMALLER of the two legs (`min(a0·L/r0, a1·L/r1)`), so an imbalanced
///         add cannot mint shares off one leg and redeem them off both. First
///         deposit burns MINIMUM_LIQUIDITY to address(0) so the pool can never
///         be fully drained and re-created at an attacker's price. Fee is
///         owner-only.
///
///         WP-06 / #11: every value-moving entry point takes a `deadline`
///         (a stuck transaction can otherwise execute much later at a price the
///         sender never agreed to) and the swaps take a `minOut` (without one,
///         every swap is a free sandwich for anyone reading the mempool). Both
///         directions exist — the pool used to trade one way only.
///
///         WP-08/09 (#9/#10): tokens are typed as `IERC20` (not a type named
///         "Mock") and every call goes through `SafeERC20`, so a token that
///         returns false cannot silently credit a deposit that never arrived.
contract SimplePair {
    using SafeERC20 for IERC20;

    IERC20 public immutable token0;
    IERC20 public immutable token1;
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
    error Expired();
    error MinOut();
    error MinShares();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @dev WP-06 / #11: `deadline == type(uint256).max` means "no deadline", so
    ///      callers that do not care pass the max and callers that do get a real
    ///      bound. Zero is NOT the sentinel: `block.timestamp` can legitimately
    ///      be 0-1 (a freshly started chain, a Foundry default), and treating 0
    ///      as "no deadline" makes an already-expired deadline unrepresentable.
    modifier notExpired(uint256 deadline) {
        if (deadline != type(uint256).max && block.timestamp > deadline) revert Expired();
        _;
    }

    constructor(IERC20 t0, IERC20 t1, uint256 feeBps_) {
        token0 = t0;
        token1 = t1;
        feeBps = feeBps_;
        owner = msg.sender;
    }

    function setFeeBps(uint256 bps) external onlyOwner {
        if (bps < 5 || bps > 30) revert Fee();
        feeBps = bps;
    }

    /// @notice Unbounded-deadline convenience wrapper (tests, tooling).
    function add(uint256 a0, uint256 a1) external returns (uint256 shares) {
        return add(a0, a1, 0, type(uint256).max);
    }

    /// @param minShares WP-06 / #11: revert rather than mint fewer shares than
    ///                    the depositor priced in.
    /// @param deadline    WP-06 / #11: revert if this lands after `deadline`.
    function add(uint256 a0, uint256 a1, uint256 minShares, uint256 deadline)
        public
        notExpired(deadline)
        returns (uint256 shares)
    {
        if (a0 == 0 || a1 == 0) revert Zero();
        token0.safeTransferFrom(msg.sender, address(this), a0);
        token1.safeTransferFrom(msg.sender, address(this), a1);
        if (lpSupply == 0) {
            if (a0 < MINIMUM_LIQUIDITY || a1 < MINIMUM_LIQUIDITY) revert Zero();
            shares = a0 - MINIMUM_LIQUIDITY;
            // V2-style burn, counted in the supply exactly once: the shared
            // `lpSupply += shares` tail below folds the user's shares in, so
            // total supply = MINIMUM_LIQUIDITY + shares = a0. (The old code
            // also set lpSupply = a0 here, double-counting the first add and
            // letting a first LP claw back only ~half their deposit.)
            lpSupply = MINIMUM_LIQUIDITY;
            lpOf[address(0)] += MINIMUM_LIQUIDITY; // burned, never redeemable
        } else {
            // Fair shares: priced on the SMALLER proportional leg, so neither
            // side of the deposit can be over-credited.
            uint256 s0 = (a0 * lpSupply) / reserve0;
            uint256 s1 = (a1 * lpSupply) / reserve1;
            shares = s0 < s1 ? s0 : s1;
        }
        if (shares < minShares) revert MinShares();
        reserve0 += a0;
        reserve1 += a1;
        lpSupply += shares;
        lpOf[msg.sender] += shares;
    }

    /// @notice Unbounded-deadline convenience wrapper (tests, tooling).
    function remove(uint256 shares) external returns (uint256 a0, uint256 a1) {
        return remove(shares, 0, 0, type(uint256).max);
    }

    /// @param min0 WP-06 / #11: floor on each leg the LP receives.
    /// @param min1 WP-06 / #11: floor on each leg the LP receives.
    function remove(uint256 shares, uint256 min0, uint256 min1, uint256 deadline)
        public
        notExpired(deadline)
        returns (uint256 a0, uint256 a1)
    {
        if (shares == 0 || shares > lpOf[msg.sender]) revert Zero();
        a0 = (shares * reserve0) / lpSupply;
        a1 = (shares * reserve1) / lpSupply;
        if (a0 < min0 || a1 < min1) revert MinOut();
        lpOf[msg.sender] -= shares;
        lpSupply -= shares;
        reserve0 -= a0;
        reserve1 -= a1;
        token0.safeTransfer(msg.sender, a0);
        token1.safeTransfer(msg.sender, a1);
    }

    /// @notice Unbounded-deadline convenience wrapper (tests, tooling).
    function swap0for1(uint256 amtIn) external returns (uint256 out) {
        return swap0for1(amtIn, 0, type(uint256).max);
    }

    /// @notice Sell `amtIn` of token0 for token1.
    /// @param minOut   WP-06 / #11: revert rather than accept a sandwiched fill.
    /// @param deadline WP-06 / #11: revert if this lands after `deadline`.
    function swap0for1(uint256 amtIn, uint256 minOut, uint256 deadline)
        public
        notExpired(deadline)
        returns (uint256 out)
    {
        if (amtIn == 0) revert Zero();
        token0.safeTransferFrom(msg.sender, address(this), amtIn);
        uint256 inWfee = amtIn * (10_000 - feeBps);
        out = (inWfee * reserve1) / (reserve0 * 10_000 + inWfee);
        if (out < minOut) revert MinOut();
        reserve0 += amtIn;
        reserve1 -= out;
        token1.safeTransfer(msg.sender, out);
    }

    /// @notice Unbounded-deadline convenience wrapper (tests, tooling).
    function swap1for0(uint256 amtIn) external returns (uint256 out) {
        return swap1for0(amtIn, 0, type(uint256).max);
    }

    /// @notice WP-06 / #11: the reverse direction. The pool previously traded
    ///         one way only, so token1 holders could not exit at all.
    function swap1for0(uint256 amtIn, uint256 minOut, uint256 deadline)
        public
        notExpired(deadline)
        returns (uint256 out)
    {
        if (amtIn == 0) revert Zero();
        token1.safeTransferFrom(msg.sender, address(this), amtIn);
        uint256 inWfee = amtIn * (10_000 - feeBps);
        out = (inWfee * reserve0) / (reserve1 * 10_000 + inWfee);
        if (out < minOut) revert MinOut();
        reserve1 += amtIn;
        reserve0 -= out;
        token0.safeTransfer(msg.sender, out);
    }
}
