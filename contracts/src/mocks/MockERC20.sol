// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20Base} from "../ERC20Base.sol";

/// @notice TEST FIXTURE ONLY. Not a production token — nothing under
///         `contracts/src/` may inherit or deploy this (WP-08 / #9).
///
///         It now sits on `ERC20Base`, so even the fixture emits the standard
///         `Transfer` / `Approval` logs and is convertible to `IERC20`.
///
///         `mint` is deliberately `external` and ungated here: tests need to
///         fund arbitrary accounts in one call. That is exactly why no
///         production contract may inherit it — `ERC20Base` exposes minting
///         only as `internal _mint`, and `WPIT` gates it behind `minter`.
contract MockERC20 is ERC20Base {
    constructor(string memory name_, string memory symbol_, uint8 decimals_)
        ERC20Base(name_, symbol_, decimals_)
    {}

    function mint(address to, uint256 amt) external {
        _mint(to, amt);
    }
}
