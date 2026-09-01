// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MedianOracle} from "../src/oracle/MedianOracle.sol";
import {ChainlinkOracle} from "../src/oracle/ChainlinkOracle.sol";
import {MockOracle} from "../src/mocks/MockOracle.sol";

/// @notice Minimal Chainlink aggregator stub for the adapter's owner guard.
contract MockAgg {
    function decimals() external pure returns (uint8) {
        return 8;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, 4_000e8, block.timestamp, block.timestamp, 1);
    }
}

/// @notice Source that reverts on read — a dead Chainlink adapter mid-outage.
contract RevertingOracle {
    function ethUsdc() external pure returns (uint256) {
        revert("outage");
    }
}

interface Vm {
    function prank(address) external;
}

contract MedianOracleTest {
    Vm constant vm = Vm(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);
    MockOracle a;
    MockOracle b;
    MockOracle c;

    function setUp() public {
        a = new MockOracle(4_000e6);
        b = new MockOracle(4_010e6);
        c = new MockOracle(3_990e6);
    }

    function testThreeHealthyReturnsMedian() public {
        MedianOracle m = new MedianOracle(address(a), address(b), address(c));
        require(m.ethUsdc() == 4_000e6, "median of 3990/4000/4010 is 4000");
        // A single wild source cannot move the median past the sane pair.
        c.set(1_000_000e6);
        require(m.ethUsdc() == 4_010e6, "wild third pins to the sane pair");
    }

    function testTwoHealthyReturnsBandCheckedMidpoint() public {
        MedianOracle m = new MedianOracle(address(a), address(b), address(0));
        require(m.ethUsdc() == 4_005e6, "midpoint of two");
        // Third-slot deployment with one dead source degrades to the same.
        MedianOracle m3 = new MedianOracle(address(a), address(b), address(new RevertingOracle()));
        require(m3.ethUsdc() == 4_005e6, "dead third -> midpoint of the two live");
    }

    function testDisagreementFailsClosed() public {
        MedianOracle m = new MedianOracle(address(a), address(b), address(0));
        b.set(4_400e6); // 10% above a — beyond the 5% default band
        require(m.ethUsdc() == 0, "spread beyond maxDevBps is no price");
        m.setMaxDevBps(2_000); // widen to 20%
        require(m.ethUsdc() == (4_000e6 + 4_400e6) / 2, "inside the widened band");
    }

    function testNoQuorumFailsClosed() public {
        MedianOracle m = new MedianOracle(address(a), address(b), address(c));
        a.set(0); // stale (0 = no price)
        b.set(0);
        require(m.ethUsdc() == 0, "one healthy source is not a quorum");
        a.set(0);
        b.set(0);
        c.set(0);
        require(m.ethUsdc() == 0, "zero healthy sources");
    }

    function testOwnerGuards() public {
        MedianOracle m = new MedianOracle(address(a), address(b), address(0));
        // Non-owner cannot tune the band or take over.
        vm.prank(address(0xBAD));
        (bool ok,) = address(m).call(abi.encodeWithSignature("setMaxDevBps(uint256)", 100));
        require(!ok, "non-owner setMaxDevBps must revert");
        // Deviation bounds are enforced.
        (ok,) = address(m).call(abi.encodeWithSignature("setMaxDevBps(uint256)", 5));
        require(!ok, "band below 10 bps rejected");
        (ok,) = address(m).call(abi.encodeWithSignature("setMaxDevBps(uint256)", 3_000));
        require(!ok, "band above 2000 bps rejected");
        // Zero owner would brick the admin forever.
        (ok,) = address(m).call(abi.encodeWithSignature("setOwner(address)", address(0)));
        require(!ok, "zero owner rejected");
        m.setOwner(address(0xB0B));
        require(m.owner() == address(0xB0B), "owner handed over");
    }

    function testZeroPrimarySourcesRejected() public {
        (bool ok,) = address(this).call(abi.encodeWithSignature("deployZero()"));
        require(!ok, "zero primary source rejected");
    }

    function deployZero() external {
        new MedianOracle(address(0), address(a), address(0));
    }

    /// Audit note: `ChainlinkOracle.setOwner(0)` used to be allowed — a zero
    ///        owner bricks `setBand` forever. Now rejected.
    function testChainlinkOracleRejectsZeroOwner() public {
        ChainlinkOracle o = new ChainlinkOracle(address(new MockAgg()));
        require(o.ethUsdc() == 4_000e6, "adapter scales 8 -> 6 decimals");
        (bool ok,) = address(o).call(abi.encodeWithSignature("setOwner(address)", address(0)));
        require(!ok, "zero owner rejected");
        o.setOwner(address(0xB0B));
        require(o.owner() == address(0xB0B), "handover still works");
    }
}
