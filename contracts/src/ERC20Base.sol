// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./DealerVault.sol";

/// @notice Standard ERC-20 base with the mandatory `Transfer` / `Approval`
///         events (WP-08 / #9).
///
///         WPIT used to inherit `mocks/MockERC20`, which declared and emitted
///         NEITHER event. The consequences are external and total: block
///         explorers show no history, wallets show no balance changes, indexers
///         see an inert contract, and exchange deposit crediting — which is
///         driven by `Transfer` logs — does not work at all.
///
///         This replaces that base for anything under `src/`. `MockERC20` is
///         retained only as a test fixture and must not be inherited by a
///         production contract again.
///
///         `_mint` is `internal` here — a public, access-free `mint` (the old
///         `MockERC20.mint`) is a hazard for any contract that forgets to
///         override it. Subclasses expose minting through their own auth.
abstract contract ERC20Base is IERC20 {
    string public name;
    string public symbol;
    uint8 public immutable decimals;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    error InsufficientBalance();
    error InsufficientAllowance();

    constructor(string memory name_, string memory symbol_, uint8 decimals_) {
        name = name_;
        symbol = symbol_;
        decimals = decimals_;
    }

    function transfer(address to, uint256 amt) external virtual returns (bool) {
        _transfer(msg.sender, to, amt);
        return true;
    }

    function approve(address spender, uint256 amt) external virtual returns (bool) {
        allowance[msg.sender][spender] = amt;
        emit Approval(msg.sender, spender, amt);
        return true;
    }

    function transferFrom(address from, address to, uint256 amt) external virtual returns (bool) {
        uint256 a = allowance[from][msg.sender];
        if (a < amt) revert InsufficientAllowance();
        if (a != type(uint256).max) allowance[from][msg.sender] = a - amt;
        _transfer(from, to, amt);
        return true;
    }

    function _transfer(address from, address to, uint256 amt) internal {
        if (balanceOf[from] < amt) revert InsufficientBalance();
        unchecked {
            balanceOf[from] -= amt;
        }
        balanceOf[to] += amt;
        emit Transfer(from, to, amt);
    }

    function _mint(address to, uint256 amt) internal {
        totalSupply += amt;
        balanceOf[to] += amt;
        emit Transfer(address(0), to, amt);
    }
}
