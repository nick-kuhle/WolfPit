// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockERC20} from "./mocks/MockERC20.sol";

/// @notice TEST dealer vault. Base-shaped. Not Ethereum L1. No Uni v4 hook.
contract DealerVault {
    uint256 public constant ALPHA_BPS = 4_000; // 40%
    uint256 public constant WAD = 1e18;

    MockERC20 public immutable usdc;
    MockERC20 public immutable weth;

    uint256 public ethBal;
    uint256 public usdcBal;
    uint256 public reservedEth;
    uint256 public reservedUsdc;
    uint256 public shares;
    bool public paused;
    uint256 public insuranceUsdc;
    uint256 public insuranceWpit;
    uint256 public constant INSURANCE_NAV_MIN_BPS = 100; // 1%

    error InsuranceHalt();

    mapping(address => uint256) public shareOf;

    error Paused();
    error NakedCall();
    error NakedPut();
    error UtilCap();
    error Zero();

    constructor(MockERC20 usdc_, MockERC20 weth_) {
        usdc = usdc_;
        weth = weth_;
    }

    modifier live() {
        if (paused) revert Paused();
        _;
    }

    function pause(bool v) external {
        paused = v;
    }

    function deposit(uint256 ethAmt, uint256 usdcAmt) external live {
        if (ethAmt == 0 && usdcAmt == 0) revert Zero();
        if (ethAmt > 0) {
            weth.transferFrom(msg.sender, address(this), ethAmt);
            ethBal += ethAmt;
        }
        if (usdcAmt > 0) {
            usdc.transferFrom(msg.sender, address(this), usdcAmt);
            usdcBal += usdcAmt;
        }
        uint256 minted = ethAmt + usdcAmt;
        shares += minted;
        shareOf[msg.sender] += minted;
    }

    function freeEth() public view returns (uint256) {
        return ethBal > reservedEth ? ethBal - reservedEth : 0;
    }

    function freeUsdc() public view returns (uint256) {
        return usdcBal > reservedUsdc ? usdcBal - reservedUsdc : 0;
    }

    function creditInsurance(uint256 usdcAmt) external {
        insuranceUsdc += usdcAmt;
    }

    function creditInsuranceWpit(uint256 amt) external {
        insuranceWpit += amt;
    }

    function utilBps() public view returns (uint256) {
        if (ethBal == 0) return 10_000;
        return (reservedEth * 10_000) / ethBal;
    }

    function navUsdc(uint256 spot) public view returns (uint256) {
        return usdcBal + (ethBal * spot) / WAD;
    }

    function haltShortGamma(uint256 spot) public view returns (bool) {
        if (insuranceUsdc == 0) return false;
        uint256 nav = navUsdc(spot);
        if (nav == 0) return true;
        return insuranceUsdc * 10_000 < nav * INSURANCE_NAV_MIN_BPS;
    }

    function writeCall(uint256 size) external live {
        if (size == 0) revert Zero();
        if (haltShortGamma(4_000e6)) revert InsuranceHalt();
        if (size > freeEth()) revert NakedCall();
        reservedEth += size;
        if (reservedEth * 10_000 > ethBal * ALPHA_BPS) revert UtilCap();
    }

    function writePut(uint256 size, uint256 strike) external live {
        if (size == 0) revert Zero();
        uint256 lock = size * strike / WAD;
        if (lock > freeUsdc()) revert NakedPut();
        reservedUsdc += lock;
        if (reservedUsdc * 10_000 > usdcBal * ALPHA_BPS) revert UtilCap();
    }

    function openLong(uint256 size) external live {
        if (size == 0) revert Zero();
        reservedEth += size;
        if (reservedEth * 10_000 > ethBal * ALPHA_BPS) revert UtilCap();
    }

    function openShort(uint256 size, uint256 spot) external live {
        if (size == 0) revert Zero();
        uint256 lock = size * spot / WAD;
        reservedUsdc += lock;
        if (ethBal < size) revert NakedCall();
        ethBal -= size;
        usdcBal += lock;
        if (reservedUsdc * 10_000 > usdcBal * ALPHA_BPS) revert UtilCap();
    }

    function releaseCall(uint256 size) external live {
        reservedEth -= size;
    }

    function releasePut(uint256 lock) external live {
        reservedUsdc -= lock;
    }
}
