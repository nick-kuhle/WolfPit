// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20Base} from "./ERC20Base.sol";

/// @notice WPIT-TEST. Cap. Not an offering.
contract WPIT is ERC20Base {
    uint256 public immutable cap;
    address public minter;

    error Cap();
    error Minter();
    error ZeroMinter();

    event MinterProposed(address indexed pending);
    event MinterSet(address indexed previous, address indexed next);

    address public pendingMinter;

    constructor(uint256 cap_) ERC20Base("WolfPit TEST", "WPIT-TEST", 18) {
        cap = cap_;
        minter = msg.sender;
    }

    /// @notice Two-step transfer (like DealerVault ownership): propose, then
    ///         accept. A typo'd address is visible between the two txs instead
    ///         of permanently handing the mint key to the void. Zero is never
    ///         proposable AND never acceptable (see `acceptMinter`), so
    ///         emissions can never be locked forever.
    function setMinter(address m) external {
        if (msg.sender != minter) revert Minter();
        if (m == address(0)) revert ZeroMinter();
        pendingMinter = m;
        emit MinterProposed(m);
    }

    /// @notice The pending minter — or the current minter (e.g. the Deployer,
    ///         which cannot act as the farm contract) — finalizes the move.
    ///
    ///         WP-13 / #18: a NULL proposal must revert. `pendingMinter` rests
    ///         at address(0), and the old body copied it into `minter`
    ///         unconditionally — so a stray call, a retried deploy step or a
    ///         double-click in a runbook set minter to the zero address. That
    ///         is unrecoverable: `mint()` requires `msg.sender == minter`,
    ///         nobody can transact as address(0), and `setMinter` rejects zero
    ///         so the transfer cannot even be re-proposed. Emissions would stop
    ///         permanently. `Deployer` calls `setMinter` then `acceptMinter`
    ///         back to back, so the deploy path stays valid.
    function acceptMinter() external {
        address next = pendingMinter;
        if (next == address(0)) revert ZeroMinter();
        if (msg.sender != next && msg.sender != minter) revert Minter();
        address prev = minter;
        minter = next;
        pendingMinter = address(0);
        emit MinterSet(prev, next);
    }

    /// @notice Minter-gated issuance. WP-08 / #9: minting goes through
    ///         `ERC20Base._mint`, so the supply move emits a standard
    ///         `Transfer(address(0), to, amt)` — indexers, explorers and
    ///         exchange deposit crediting all key off that log.
    function mint(address to, uint256 amt) external {
        if (msg.sender != minter) revert Minter();
        if (totalSupply + amt > cap) revert Cap();
        _mint(to, amt);
    }
}
