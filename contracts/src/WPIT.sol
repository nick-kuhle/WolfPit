// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockERC20} from "./mocks/MockERC20.sol";

/// @notice WPIT-TEST. Cap. Not an offering.
contract WPIT is MockERC20 {
    uint256 public immutable cap;
    address public minter;

    error Cap();
    error Minter();
    error ZeroMinter();

    event MinterProposed(address indexed pending);
    event MinterSet(address indexed previous, address indexed next);

    address public pendingMinter;

    constructor(uint256 cap_) MockERC20("WolfPit TEST", "WPIT-TEST", 18) {
        cap = cap_;
        minter = msg.sender;
    }

    /// @notice Two-step transfer (like DealerVault ownership): propose, then
    ///         accept. A typo'd address is visible between the two txs instead
    ///         of permanently handing the mint key to the void. Zero is never
    ///         proposable, so emissions can never be locked forever.
    function setMinter(address m) external {
        if (msg.sender != minter) revert Minter();
        if (m == address(0)) revert ZeroMinter();
        pendingMinter = m;
        emit MinterProposed(m);
    }

    /// @notice The pending minter — or the current minter (e.g. the Deployer,
    ///         which cannot act as the farm contract) — finalizes the move.
    function acceptMinter() external {
        if (msg.sender != pendingMinter && msg.sender != minter) revert Minter();
        address prev = minter;
        minter = pendingMinter;
        pendingMinter = address(0);
        emit MinterSet(prev, minter);
    }

    function mint(address to, uint256 amt) external override {
        if (msg.sender != minter) revert Minter();
        if (totalSupply + amt > cap) revert Cap();
        totalSupply += amt;
        balanceOf[to] += amt;
    }
}
