// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal Chainlink AggregatorV3 (ETH/USD on Base).
interface AggregatorV3Interface {
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
    function decimals() external view returns (uint8);
}

/// @notice Oracle adapter: Chainlink ETH/USD → USDC-per-1e18-WETH (6 dec).
///         Fail-closed: stale (>1h), non-positive, or out-of-band readings
///         revert so DealerVault halts risk-taking instead of marking fantasy.
contract ChainlinkOracle {
    uint256 public constant WAD = 1e18;
    uint256 public constant MAX_STALENESS = 3_600;
    /// @notice Sanity band: $500 – $250,000 / ETH. Owner-tightenable.
    uint256 public minUsdc = 500e6;
    uint256 public maxUsdc = 250_000e6;

    AggregatorV3Interface public immutable agg;
    address public owner;
    uint8 public immutable aggDecimals;

    error NotOwner();
    error Stale();
    error BadRound();
    error OutOfBand();

    event OwnerSet(address indexed previous, address indexed next);
    event BandSet(uint256 minUsdc, uint256 maxUsdc);

    constructor(address agg_) {
        agg = AggregatorV3Interface(agg_);
        owner = msg.sender;
        aggDecimals = agg.decimals();
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    function setOwner(address next) external onlyOwner {
        emit OwnerSet(owner, next);
        owner = next;
    }

    function setBand(uint256 lo, uint256 hi) external onlyOwner {
        if (lo == 0 || hi <= lo) revert OutOfBand();
        minUsdc = lo;
        maxUsdc = hi;
        emit BandSet(lo, hi);
    }

    function ethUsdc() external view returns (uint256) {
        (, int256 answer,, uint256 updatedAt, uint80 answeredInRound) = agg.latestRoundData();
        if (answer <= 0 || answeredInRound == 0) revert BadRound();
        if (block.timestamp - updatedAt > MAX_STALENESS) revert Stale();
        uint256 usdcPerEth = uint256(answer); // aggDecimals (8) → 6
        if (aggDecimals > 6) {
            usdcPerEth = usdcPerEth / (10 ** (uint256(aggDecimals) - 6));
        } else if (aggDecimals < 6) {
            usdcPerEth = usdcPerEth * (10 ** (6 - uint256(aggDecimals)));
        }
        if (usdcPerEth < minUsdc || usdcPerEth > maxUsdc) revert OutOfBand();
        return usdcPerEth; // USDC (6 dec) per 1 ETH; vault scales by WAD
    }
}
