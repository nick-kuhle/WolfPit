// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Median-of-sources ETH/USDC oracle for DealerVault (v1.1 hardening:
///         no single price source should be able to mark the book).
///
///         Sources are any contracts exposing the vault's `ethUsdc()` shape
///         (USDC per 1e18 WETH, 6 dec) — e.g. `ChainlinkOracle` plus a Uni v3
///         TWAP adapter. Each is read through a try/catch-style staticcall:
///         a revert or a 0 answer marks the source unhealthy (both are the
///         documented fail-closed signals of the IOracle contract).
///
///         Aggregation — fail-closed at every step, mirroring the vault's
///         "0 = no price" convention:
///           - fewer than 2 healthy sources        → 0 (no quorum)
///           - 2 healthy: spread beyond maxDevBps  → 0 (disagreement)
///                        otherwise                → midpoint (median of two)
///           - 3 healthy                           → true median (the middle
///             value; one wild source cannot move it past the other two)
contract MedianOracle {
    /// @notice Price sources (ethUsdc() shape). `srcC` may be address(0) for
    ///         a dual-source deployment.
    address public immutable srcA;
    address public immutable srcB;
    address public immutable srcC;

    address public owner;
    /// @notice Max tolerated spread between 2 healthy sources, bps of the
    ///         lower value. Owner-tunable inside [10, 2_000].
    uint256 public maxDevBps = 500;

    error NotOwner();
    error ZeroAddress();
    error BadDeviation();

    event OwnerSet(address indexed previous, address indexed next);
    event MaxDevSet(uint256 previous, uint256 next);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address a, address b, address c) {
        if (a == address(0) || b == address(0)) revert ZeroAddress();
        srcA = a;
        srcB = b;
        srcC = c; // optional third source
        owner = msg.sender;
    }

    function setOwner(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress(); // never brick the oracle admin
        emit OwnerSet(owner, next);
        owner = next;
    }

    function setMaxDevBps(uint256 bps) external onlyOwner {
        if (bps < 10 || bps > 2_000) revert BadDeviation();
        emit MaxDevSet(maxDevBps, bps);
        maxDevBps = bps;
    }

    /// @notice Vault-facing read. Returns 0 (fail closed) unless at least two
    ///         healthy sources agree per the rules above.
    function ethUsdc() external view returns (uint256) {
        uint256 a = _read(srcA);
        uint256 b = _read(srcB);
        uint256 c = srcC == address(0) ? 0 : _read(srcC);

        // Collect healthy (non-zero) answers.
        uint256 n;
        uint256 x;
        uint256 y;
        uint256 z;
        if (a != 0) (n, x) = (n + 1, a);
        if (b != 0) {
            n += 1;
            if (n == 1) x = b;
            else y = b;
        }
        if (c != 0) {
            n += 1;
            if (n == 1) x = c;
            else if (n == 2) y = c;
            else z = c;
        }

        if (n < 2) return 0; // no quorum — vault halts risk
        if (n == 2) {
            (uint256 lo, uint256 hi) = x < y ? (x, y) : (y, x);
            if ((hi - lo) * 10_000 > lo * maxDevBps) return 0; // disagreement
            return (lo + hi) / 2;
        }
        // n == 3: median — sort the three, return the middle.
        if (x > y) (x, y) = (y, x);
        if (y > z) (y, z) = (z, y);
        if (x > y) (x, y) = (y, x);
        return y;
    }

    /// @dev Tolerant read: a reverting or malformed source is "no price",
    ///      never a bricked median.
    function _read(address src) internal view returns (uint256 v) {
        (bool ok, bytes memory ret) = src.staticcall(abi.encodeWithSignature("ethUsdc()"));
        if (!ok || ret.length < 32) return 0;
        v = abi.decode(ret, (uint256));
    }
}
